import type { componentsV1, PhoenixClient } from "@arizeai/phoenix-client";
import { Command } from "commander";

import { createPhoenixClient } from "../client";
import {
  getConfigErrorMessage,
  resolveConfig,
  validateConfig,
} from "../config";
import { assertDeletesEnabled, confirmOrExit } from "../confirm";
import { ExitCode, getExitCodeForError } from "../exitCodes";
import { writeError, writeOutput, writeProgress } from "../io";
import { writeStructuredError } from "../structuredError";
import {
  parseJsonArrayFlag,
  parseJsonObjectFlag,
  readInlineOrFile,
} from "./evaluatorInputs";
import {
  formatDatasetEvaluatorOutput,
  formatDatasetEvaluatorsOutput,
  type OutputFormat,
} from "./formatDatasetEvaluator";
import type { CommonOptions, DeleteOptions } from "./options";

type DatasetEvaluator = componentsV1["schemas"]["DatasetEvaluator"];
type CreateRequest = componentsV1["schemas"]["CreateDatasetEvaluatorRequest"];
type PatchRequest = componentsV1["schemas"]["PatchDatasetEvaluatorRequest"];
type InputMapping = componentsV1["schemas"]["InputMapping"];
type OutputConfig = NonNullable<CreateRequest["output_configs"]>[number];
type EvaluatorInput = CreateRequest["evaluator"];

/**
 * Options for `px dataset evaluator list <dataset-identifier>`.
 */
interface DatasetEvaluatorListOptions extends CommonOptions<OutputFormat> {
  /**
   * `--limit <number>`: Maximum number of bindings to fetch. Defaults to
   * fetching every page.
   *
   * @example 50
   */
  limit?: number;
}

/**
 * Options for `px dataset evaluator get <dataset-evaluator-id>`.
 */
type DatasetEvaluatorGetOptions = CommonOptions<OutputFormat>;

/**
 * Flags shared by create and update for the binding's own fields.
 */
interface DatasetEvaluatorFieldOptions extends CommonOptions<OutputFormat> {
  /**
   * `--name <name>`: The binding's name, unique within the dataset.
   *
   * @example "exact-match"
   */
  name?: string;
  /**
   * `--description <text>`: Overrides the shared definition's description.
   */
  description?: string;
  /**
   * `--input-mapping <json>`: JSON object with `literal_mapping` and
   * `path_mapping` keys mapping example and run fields onto evaluator
   * arguments.
   *
   * @example '{"literal_mapping":{},"path_mapping":{"output":"output"}}'
   */
  inputMapping?: string;
  /**
   * `--output-configs <json>`: JSON array of output configurations that
   * override the shared definition's.
   */
  outputConfigs?: string;
}

/**
 * Options for `px dataset evaluator create <dataset-identifier>`. Exactly one
 * of `--evaluator-id`, `--evaluator`, or `--evaluator-file` selects the
 * evaluator.
 */
interface DatasetEvaluatorCreateOptions extends DatasetEvaluatorFieldOptions {
  /**
   * `--evaluator-id <id>`: Bind an existing code or built-in evaluator.
   *
   * @example "RXZhbHVhdG9yOjI="
   */
  evaluatorId?: string;
  /**
   * `--evaluator <json>`: Inline JSON for a new LLM or code evaluator, with a
   * `type` of `llm` or `code`.
   */
  evaluator?: string;
  /**
   * `--evaluator-file <path>`: Read the new evaluator JSON from a file.
   *
   * @example "./toxicity-evaluator.json"
   */
  evaluatorFile?: string;
}

/**
 * Options for `px dataset evaluator update <dataset-evaluator-id>`.
 */
type DatasetEvaluatorUpdateOptions = DatasetEvaluatorFieldOptions;

/**
 * Options for `px dataset evaluator delete <dataset-evaluator-id...>`.
 */
interface DatasetEvaluatorDeleteOptions extends DeleteOptions {
  /**
   * `--keep-prompt`: Keep the prompt of an LLM evaluator that becomes
   * unreferenced instead of deleting it with the binding.
   *
   * @example true
   */
  keepPrompt?: boolean;
}

function createClientOrExit(
  options: CommonOptions<OutputFormat> | DeleteOptions
): PhoenixClient {
  const config = resolveConfig({
    cliOptions: {
      endpoint: options.endpoint,
      apiKey: options.apiKey,
    },
  });
  const validation = validateConfig({ config, projectRequired: false });
  if (!validation.valid) {
    writeError({
      message: getConfigErrorMessage({ errors: validation.errors }),
    });
    process.exit(ExitCode.INVALID_ARGUMENT);
  }
  return createPhoenixClient({ config });
}

async function fetchDatasetEvaluators(
  client: PhoenixClient,
  datasetIdentifier: string,
  options: { limit?: number } = {}
): Promise<DatasetEvaluator[]> {
  const bindings: DatasetEvaluator[] = [];
  let cursor: string | undefined;
  const pageLimit = options.limit || 100;

  do {
    const response = await client.GET(
      "/v1/datasets/{dataset_identifier}/evaluators",
      {
        params: {
          path: { dataset_identifier: datasetIdentifier },
          query: { cursor, limit: pageLimit },
        },
      }
    );
    if (response.error || !response.data) {
      throw new Error(
        `Failed to fetch evaluators for dataset "${datasetIdentifier}": ${response.error || "Unknown error"}`
      );
    }
    bindings.push(...response.data.data);
    cursor = response.data.next_cursor || undefined;
    if (options.limit && bindings.length >= options.limit) {
      break;
    }
  } while (cursor);

  return options.limit ? bindings.slice(0, options.limit) : bindings;
}

/**
 * Handler for `dataset evaluator list`
 */
async function datasetEvaluatorListHandler(
  datasetIdentifier: string,
  options: DatasetEvaluatorListOptions
): Promise<void> {
  try {
    const client = createClientOrExit(options);

    writeProgress({
      message: `Fetching evaluators for dataset "${datasetIdentifier}"...`,
      noProgress: !options.progress,
    });

    const bindings = await fetchDatasetEvaluators(client, datasetIdentifier, {
      limit: options.limit,
    });

    writeProgress({
      message: `Found ${bindings.length} dataset evaluator(s)`,
      noProgress: !options.progress,
    });

    writeOutput({
      message: formatDatasetEvaluatorsOutput({
        bindings,
        format: options.format,
      }),
    });
  } catch (error) {
    writeError({
      message: `Error fetching dataset evaluators: ${error instanceof Error ? error.message : String(error)}`,
    });
    process.exit(getExitCodeForError(error));
  }
}

/**
 * Handler for `dataset evaluator get`
 */
async function datasetEvaluatorGetHandler(
  datasetEvaluatorId: string,
  options: DatasetEvaluatorGetOptions
): Promise<void> {
  try {
    const client = createClientOrExit(options);

    writeProgress({
      message: `Fetching dataset evaluator ${datasetEvaluatorId}...`,
      noProgress: !options.progress,
    });

    const response = await client.GET(
      "/v1/dataset_evaluators/{dataset_evaluator_id}",
      { params: { path: { dataset_evaluator_id: datasetEvaluatorId } } }
    );
    if (response.error || !response.data) {
      throw new Error(
        `Failed to fetch dataset evaluator "${datasetEvaluatorId}": ${response.error || "Unknown error"}`
      );
    }

    writeOutput({
      message: formatDatasetEvaluatorOutput({
        binding: response.data.data,
        format: options.format,
      }),
    });
  } catch (error) {
    writeError({
      message: `Error fetching dataset evaluator: ${error instanceof Error ? error.message : String(error)}`,
    });
    process.exit(getExitCodeForError(error));
  }
}

/**
 * Resolve the evaluator to bind from whichever flag the caller supplied.
 * Exactly one of the three forms must be present.
 */
function resolveEvaluatorInput(
  options: DatasetEvaluatorCreateOptions
): EvaluatorInput | undefined {
  const supplied = [
    options.evaluatorId,
    options.evaluator,
    options.evaluatorFile,
  ].filter((value) => value !== undefined).length;
  if (supplied !== 1) {
    return undefined;
  }
  if (options.evaluatorId !== undefined) {
    return { type: "reference", evaluator_id: options.evaluatorId };
  }
  return parseJsonObjectFlag<EvaluatorInput>({
    flag: options.evaluator !== undefined ? "--evaluator" : "--evaluator-file",
    value: readInlineOrFile({
      inline: options.evaluator,
      inlineFlag: "--evaluator",
      file: options.evaluatorFile,
      fileFlag: "--evaluator-file",
    }),
  });
}

/**
 * Handler for `dataset evaluator create`
 */
async function datasetEvaluatorCreateHandler(
  datasetIdentifier: string,
  options: DatasetEvaluatorCreateOptions
): Promise<void> {
  // Argument-shape validation runs before the try block so its `process.exit`
  // isn't caught and re-mapped by the catch-all error handler below.
  if (!options.name) {
    writeStructuredError({
      format: options.format,
      message: "Missing required flag --name",
      code: "INVALID_ARGUMENT",
      hint: `px dataset evaluator create ${datasetIdentifier} --name <name> --input-mapping <json> --evaluator-id <id>`,
    });
    process.exit(ExitCode.INVALID_ARGUMENT);
  }
  if (!options.inputMapping) {
    writeStructuredError({
      format: options.format,
      message: "Missing required flag --input-mapping",
      code: "INVALID_ARGUMENT",
      hint: `px dataset evaluator create ${datasetIdentifier} --name ${options.name} --input-mapping '{"literal_mapping":{},"path_mapping":{"output":"output"}}' --evaluator-id <id>`,
    });
    process.exit(ExitCode.INVALID_ARGUMENT);
  }
  const evaluatorFlags = [
    options.evaluatorId,
    options.evaluator,
    options.evaluatorFile,
  ].filter((value) => value !== undefined).length;
  if (evaluatorFlags !== 1) {
    writeStructuredError({
      format: options.format,
      message:
        "Specify exactly one of --evaluator-id, --evaluator, or --evaluator-file",
      code: "INVALID_ARGUMENT",
      hint: `px dataset evaluator create ${datasetIdentifier} --name ${options.name} --input-mapping <json> --evaluator-id <id>`,
    });
    process.exit(ExitCode.INVALID_ARGUMENT);
  }

  try {
    const evaluator = resolveEvaluatorInput(options);
    if (evaluator === undefined) {
      throw new Error("Could not resolve the evaluator to bind");
    }
    const body: CreateRequest = {
      name: options.name,
      input_mapping: parseJsonObjectFlag<InputMapping>({
        flag: "--input-mapping",
        value: options.inputMapping,
      }),
      evaluator,
    };
    if (options.description !== undefined) {
      body.description = options.description;
    }
    if (options.outputConfigs !== undefined) {
      body.output_configs = parseJsonArrayFlag<OutputConfig>({
        flag: "--output-configs",
        value: options.outputConfigs,
      });
    }

    const client = createClientOrExit(options);

    writeProgress({
      message: `Binding evaluator to dataset "${datasetIdentifier}"...`,
      noProgress: !options.progress,
    });

    const response = await client.POST(
      "/v1/datasets/{dataset_identifier}/evaluators",
      {
        params: { path: { dataset_identifier: datasetIdentifier } },
        body,
      }
    );
    if (response.error || !response.data) {
      throw new Error(
        `Failed to create dataset evaluator: ${response.error || "Unknown error"}`
      );
    }

    writeOutput({
      message: formatDatasetEvaluatorOutput({
        binding: response.data.data,
        format: options.format,
      }),
    });
  } catch (error) {
    writeError({
      message: `Error creating dataset evaluator: ${error instanceof Error ? error.message : String(error)}`,
    });
    process.exit(getExitCodeForError(error));
  }
}

/**
 * Handler for `dataset evaluator update`
 */
async function datasetEvaluatorUpdateHandler(
  datasetEvaluatorId: string,
  options: DatasetEvaluatorUpdateOptions
): Promise<void> {
  const fieldFlags = [
    options.name,
    options.description,
    options.inputMapping,
    options.outputConfigs,
  ];
  if (fieldFlags.every((value) => value === undefined)) {
    writeStructuredError({
      format: options.format,
      message: "Nothing to update: pass at least one field flag",
      code: "INVALID_ARGUMENT",
      hint: `px dataset evaluator update ${datasetEvaluatorId} --name <name>`,
    });
    process.exit(ExitCode.INVALID_ARGUMENT);
  }

  try {
    const body: PatchRequest = {};
    if (options.name !== undefined) {
      body.name = options.name;
    }
    if (options.description !== undefined) {
      body.description = options.description;
    }
    if (options.inputMapping !== undefined) {
      body.input_mapping = parseJsonObjectFlag<InputMapping>({
        flag: "--input-mapping",
        value: options.inputMapping,
      });
    }
    if (options.outputConfigs !== undefined) {
      body.output_configs = parseJsonArrayFlag<OutputConfig>({
        flag: "--output-configs",
        value: options.outputConfigs,
      });
    }

    const client = createClientOrExit(options);

    writeProgress({
      message: `Updating dataset evaluator ${datasetEvaluatorId}...`,
      noProgress: !options.progress,
    });

    const response = await client.PATCH(
      "/v1/dataset_evaluators/{dataset_evaluator_id}",
      {
        params: { path: { dataset_evaluator_id: datasetEvaluatorId } },
        body,
      }
    );
    if (response.error || !response.data) {
      throw new Error(
        `Failed to update dataset evaluator "${datasetEvaluatorId}": ${response.error || "Unknown error"}`
      );
    }

    writeOutput({
      message: formatDatasetEvaluatorOutput({
        binding: response.data.data,
        format: options.format,
      }),
    });
  } catch (error) {
    writeError({
      message: `Error updating dataset evaluator: ${error instanceof Error ? error.message : String(error)}`,
    });
    process.exit(getExitCodeForError(error));
  }
}

/**
 * Handler for `dataset evaluator delete`
 */
async function datasetEvaluatorDeleteHandler(
  datasetEvaluatorIds: string[],
  options: DatasetEvaluatorDeleteOptions
): Promise<void> {
  try {
    assertDeletesEnabled();

    const client = createClientOrExit(options);

    const noun =
      datasetEvaluatorIds.length === 1
        ? `dataset evaluator ${datasetEvaluatorIds[0]}`
        : `${datasetEvaluatorIds.length} dataset evaluators`;
    await confirmOrExit({
      message: `Delete ${noun}? This removes the binding and its evaluator traces. This cannot be undone.`,
      yes: options.yes,
    });

    const deleteAssociatedPrompt = !options.keepPrompt;
    const response =
      datasetEvaluatorIds.length === 1
        ? await client.DELETE("/v1/dataset_evaluators/{dataset_evaluator_id}", {
            params: {
              path: { dataset_evaluator_id: datasetEvaluatorIds[0] },
              query: { delete_associated_prompt: deleteAssociatedPrompt },
            },
          })
        : await client.DELETE("/v1/dataset_evaluators", {
            params: {
              query: {
                dataset_evaluator_ids: datasetEvaluatorIds,
                delete_associated_prompt: deleteAssociatedPrompt,
              },
            },
          });
    if (response.error) {
      throw new Error(`Failed to delete ${noun}: ${response.error}`);
    }

    writeProgress({
      message: `Deleted ${noun}`,
      noProgress: !options.progress,
    });
  } catch (error) {
    writeError({
      message: `Error deleting dataset evaluator: ${error instanceof Error ? error.message : String(error)}`,
    });
    process.exit(getExitCodeForError(error));
  }
}

function addBindingFieldOptions(command: Command): Command {
  return command
    .option("--name <name>", "Binding name, unique within the dataset")
    .option("--description <text>", "Description override for this binding")
    .option(
      "--input-mapping <json>",
      'JSON object with "literal_mapping" and "path_mapping" keys'
    )
    .option(
      "--output-configs <json>",
      "JSON array of output configurations that override the definition's"
    );
}

function addCommonReadOptions(command: Command): Command {
  return command
    .option("--endpoint <url>", "Phoenix API endpoint")
    .option("--api-key <key>", "Phoenix API key for authentication")
    .option(
      "--format <format>",
      "Output format: pretty, json, or raw",
      "pretty"
    )
    .option("--no-progress", "Disable progress indicators");
}

export function createDatasetEvaluatorListCommand(): Command {
  return addCommonReadOptions(
    new Command("list")
      .description(
        "List the evaluators bound to a dataset. Requires Phoenix server >= 21.0.0."
      )
      .argument("<dataset-identifier>", "Dataset name or ID")
      .option(
        "--limit <number>",
        "Maximum number of bindings to fetch",
        parseInt
      )
  )
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  px dataset evaluator list golden-questions\n" +
        "  px dataset evaluator list golden-questions --format raw --no-progress | jq -r '.[].dataset_evaluator_id'\n"
    )
    .action(datasetEvaluatorListHandler);
}

export function createDatasetEvaluatorGetCommand(): Command {
  return addCommonReadOptions(
    new Command("get")
      .description(
        "Show a dataset evaluator binding. Requires Phoenix server >= 21.0.0."
      )
      .argument("<dataset-evaluator-id>", "Dataset evaluator ID")
  ).action(datasetEvaluatorGetHandler);
}

export function createDatasetEvaluatorCreateCommand(): Command {
  return addCommonReadOptions(
    addBindingFieldOptions(
      new Command("create")
        .description(
          "Bind an evaluator to a dataset, creating the evaluator if needed. Requires Phoenix server >= 21.0.0."
        )
        .argument("<dataset-identifier>", "Dataset name or ID")
        .option(
          "--evaluator-id <id>",
          "Bind an existing code or built-in evaluator"
        )
        .option(
          "--evaluator <json>",
          'Inline JSON for a new evaluator with "type": "llm" or "code"'
        )
        .option(
          "--evaluator-file <path>",
          "Read the new evaluator JSON from a file"
        )
    )
  )
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  # Bind an existing evaluator\n" +
        '  px dataset evaluator create golden-questions --name exact-match --evaluator-id RXZhbHVhdG9yOjI= --input-mapping \'{"literal_mapping":{},"path_mapping":{"output":"output"}}\'\n\n' +
        "  # Create a new LLM evaluator from a JSON file and bind it\n" +
        '  px dataset evaluator create golden-questions --name toxicity --evaluator-file toxicity.json --input-mapping \'{"literal_mapping":{},"path_mapping":{"output":"output"}}\'\n\n' +
        "  # Capture the new binding ID (agent-friendly)\n" +
        "  px dataset evaluator create golden-questions --name exact-match --evaluator-id RXZhbHVhdG9yOjI= --input-mapping '{\"literal_mapping\":{},\"path_mapping\":{}}' --format raw --no-progress | jq -r '.dataset_evaluator_id'\n"
    )
    .action(datasetEvaluatorCreateHandler);
}

export function createDatasetEvaluatorUpdateCommand(): Command {
  return addCommonReadOptions(
    addBindingFieldOptions(
      new Command("update")
        .description(
          "Update a dataset evaluator binding; only the flags you pass are changed. Requires Phoenix server >= 21.0.0."
        )
        .argument("<dataset-evaluator-id>", "Dataset evaluator ID")
    )
  )
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  px dataset evaluator update RGF0YXNldEV2YWx1YXRvcjox --description 'Runs against the nightly golden set'\n" +
        '  px dataset evaluator update RGF0YXNldEV2YWx1YXRvcjox --input-mapping \'{"literal_mapping":{},"path_mapping":{"output":"output.text"}}\'\n'
    )
    .action(datasetEvaluatorUpdateHandler);
}

export function createDatasetEvaluatorDeleteCommand(): Command {
  return new Command("delete")
    .description(
      "Delete one or more dataset evaluator bindings. Requires Phoenix server >= 21.0.0."
    )
    .argument("<dataset-evaluator-id...>", "Dataset evaluator ID(s)")
    .option(
      "--keep-prompt",
      "Keep the prompt of an LLM evaluator that becomes unreferenced"
    )
    .option("--endpoint <url>", "Phoenix API endpoint")
    .option("--api-key <key>", "Phoenix API key for authentication")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--no-progress", "Disable progress indicators")
    .action(datasetEvaluatorDeleteHandler);
}

/**
 * Create the `dataset evaluator` command with subcommands
 */
export function createDatasetEvaluatorCommand(): Command {
  const command = new Command("evaluator");
  command.description("Manage evaluators bound to a dataset");
  command.addCommand(createDatasetEvaluatorListCommand());
  command.addCommand(createDatasetEvaluatorGetCommand());
  command.addCommand(createDatasetEvaluatorCreateCommand());
  command.addCommand(createDatasetEvaluatorUpdateCommand());
  command.addCommand(createDatasetEvaluatorDeleteCommand());
  return command;
}
