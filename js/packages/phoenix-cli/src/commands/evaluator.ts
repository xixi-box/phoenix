import type { componentsV1, PhoenixClient } from "@arizeai/phoenix-client";
import { Command } from "commander";

import { createPhoenixClient } from "../client";
import {
  getConfigErrorMessage,
  resolveConfig,
  validateConfig,
} from "../config";
import { ExitCode, getExitCodeForError } from "../exitCodes";
import { writeError, writeOutput, writeProgress } from "../io";
import { writeStructuredError } from "../structuredError";
import {
  parseJsonArrayFlag,
  parseJsonObjectFlag,
  readInlineOrFile,
} from "./evaluatorInputs";
import {
  formatEvaluatorOutput,
  formatEvaluatorVersionOutput,
  type OutputFormat,
} from "./formatEvaluator";
import type { CommonOptions } from "./options";

type EvaluatorDefinition =
  componentsV1["schemas"]["EvaluatorDefinitionResponseBody"]["data"];
type LLMEvaluatorPatch = componentsV1["schemas"]["PatchLLMEvaluatorRequest"];
type CodeEvaluatorPatch = componentsV1["schemas"]["PatchCodeEvaluatorRequest"];
type EvaluatorPatch = LLMEvaluatorPatch | CodeEvaluatorPatch;
type InputMapping = componentsV1["schemas"]["InputMapping"];
type PromptVersionData = componentsV1["schemas"]["PromptVersionData"];
type CategoricalOutputConfig =
  componentsV1["schemas"]["CategoricalAnnotationConfigData"];
type CodeOutputConfig = NonNullable<
  CodeEvaluatorPatch["output_configs"]
>[number];

const EVALUATOR_TYPES = ["llm", "code"] as const;
type EvaluatorType = (typeof EVALUATOR_TYPES)[number];

/**
 * Options for `px evaluator get <evaluator-id>`.
 */
type EvaluatorGetOptions = CommonOptions<OutputFormat>;

/**
 * Options for `px evaluator update <evaluator-id>`. `--type` selects which
 * kind of patch is sent; the remaining flags are the fields that kind accepts.
 */
interface EvaluatorUpdateOptions extends CommonOptions<OutputFormat> {
  /**
   * `--type <llm|code>`: The kind of evaluator being updated. Required, and
   * must match the evaluator on the server.
   *
   * @example "llm"
   */
  type?: string;
  /**
   * `--name <name>`: New name for the evaluator.
   *
   * @example "toxicity"
   */
  name?: string;
  /**
   * `--description <text>`: New description.
   *
   * @example "Flags responses that contradict the retrieved context"
   */
  description?: string;
  /**
   * `--output-configs <json>`: JSON array of output configurations. LLM
   * evaluators accept categorical configs only.
   *
   * @example '[{"type":"CATEGORICAL","name":"toxicity","optimization_direction":"MINIMIZE","values":[{"label":"toxic","score":1},{"label":"clean","score":0}]}]'
   */
  outputConfigs?: string;
  /**
   * `--prompt-version-id <id>`: (LLM) Use an existing prompt version.
   *
   * @example "UHJvbXB0VmVyc2lvbjox"
   */
  promptVersionId?: string;
  /**
   * `--prompt-version <json>`: (LLM) Inline prompt version content, in the
   * same shape `px prompt get --format raw` prints.
   */
  promptVersion?: string;
  /**
   * `--prompt-version-file <path>`: (LLM) Read the prompt version JSON from a
   * file instead of passing it inline.
   *
   * @example "./toxicity-prompt.json"
   */
  promptVersionFile?: string;
  /**
   * `--sandbox-config-id <id>`: (code) Sandbox configuration to run in.
   *
   * @example "U2FuZGJveENvbmZpZzox"
   */
  sandboxConfigId?: string;
  /**
   * `--input-mapping <json>`: (code) JSON object with `literal_mapping` and
   * `path_mapping` keys mapping record fields onto evaluator arguments.
   *
   * @example '{"literal_mapping":{},"path_mapping":{"output":"output"}}'
   */
  inputMapping?: string;
}

/**
 * Options for `px evaluator version create <evaluator-id>`.
 */
interface EvaluatorVersionCreateOptions extends CommonOptions<OutputFormat> {
  /**
   * `--source-code <text>`: The full source of the new version, inline.
   */
  sourceCode?: string;
  /**
   * `--file <path>`: Read the source of the new version from a file.
   *
   * @example "./evaluator.py"
   */
  file?: string;
}

function createClientOrExit(
  options: CommonOptions<OutputFormat>
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

async function fetchEvaluator(
  client: PhoenixClient,
  evaluatorId: string
): Promise<EvaluatorDefinition> {
  const response = await client.GET("/v1/evaluators/{evaluator_id}", {
    params: { path: { evaluator_id: evaluatorId } },
  });
  if (response.error || !response.data) {
    throw new Error(
      `Failed to fetch evaluator "${evaluatorId}": ${response.error || "Unknown error"}`
    );
  }
  return response.data.data;
}

/**
 * Handler for `evaluator get`
 */
async function evaluatorGetHandler(
  evaluatorId: string,
  options: EvaluatorGetOptions
): Promise<void> {
  try {
    const client = createClientOrExit(options);

    writeProgress({
      message: `Fetching evaluator ${evaluatorId}...`,
      noProgress: !options.progress,
    });

    const evaluator = await fetchEvaluator(client, evaluatorId);

    writeOutput({
      message: formatEvaluatorOutput({ evaluator, format: options.format }),
    });
  } catch (error) {
    writeError({
      message: `Error fetching evaluator: ${error instanceof Error ? error.message : String(error)}`,
    });
    process.exit(getExitCodeForError(error));
  }
}

function exitOnFlagsForOtherType({
  type,
  options,
}: {
  type: EvaluatorType;
  options: EvaluatorUpdateOptions;
}): void {
  const llmOnly = [
    ["--prompt-version-id", options.promptVersionId],
    ["--prompt-version", options.promptVersion],
    ["--prompt-version-file", options.promptVersionFile],
  ] as const;
  const codeOnly = [
    ["--sandbox-config-id", options.sandboxConfigId],
    ["--input-mapping", options.inputMapping],
  ] as const;
  const misplaced = (type === "llm" ? codeOnly : llmOnly)
    .filter(([, value]) => value !== undefined)
    .map(([flag]) => flag);
  if (misplaced.length > 0) {
    writeStructuredError({
      format: options.format,
      message: `${misplaced.join(", ")} cannot be used with --type ${type}`,
      code: "INVALID_ARGUMENT",
    });
    process.exit(ExitCode.INVALID_ARGUMENT);
  }
}

/**
 * Build the discriminated patch body from the update flags. Only flags the
 * user passed are included, so omitted fields keep their server-side values.
 */
function buildEvaluatorPatch({
  type,
  options,
}: {
  type: EvaluatorType;
  options: EvaluatorUpdateOptions;
}): EvaluatorPatch {
  const shared = {
    ...(options.name !== undefined && { name: options.name }),
    ...(options.description !== undefined && {
      description: options.description,
    }),
  };
  if (type === "llm") {
    const patch: LLMEvaluatorPatch = { type: "llm", ...shared };
    if (options.outputConfigs !== undefined) {
      patch.output_configs = parseJsonArrayFlag<CategoricalOutputConfig>({
        flag: "--output-configs",
        value: options.outputConfigs,
      });
    }
    if (options.promptVersionId !== undefined) {
      patch.prompt_version_id = options.promptVersionId;
    }
    if (
      options.promptVersion !== undefined ||
      options.promptVersionFile !== undefined
    ) {
      patch.prompt_version = parseJsonObjectFlag<PromptVersionData>({
        flag:
          options.promptVersion !== undefined
            ? "--prompt-version"
            : "--prompt-version-file",
        value: readInlineOrFile({
          inline: options.promptVersion,
          inlineFlag: "--prompt-version",
          file: options.promptVersionFile,
          fileFlag: "--prompt-version-file",
        }),
      });
    }
    return patch;
  }
  const patch: CodeEvaluatorPatch = { type: "code", ...shared };
  if (options.outputConfigs !== undefined) {
    patch.output_configs = parseJsonArrayFlag<CodeOutputConfig>({
      flag: "--output-configs",
      value: options.outputConfigs,
    });
  }
  if (options.sandboxConfigId !== undefined) {
    patch.sandbox_config_id = options.sandboxConfigId;
  }
  if (options.inputMapping !== undefined) {
    patch.input_mapping = parseJsonObjectFlag<InputMapping>({
      flag: "--input-mapping",
      value: options.inputMapping,
    });
  }
  return patch;
}

/**
 * Handler for `evaluator update`
 */
async function evaluatorUpdateHandler(
  evaluatorId: string,
  options: EvaluatorUpdateOptions
): Promise<void> {
  // Argument-shape validation runs before the try block so its `process.exit`
  // isn't caught and re-mapped by the catch-all error handler below.
  if (!options.type) {
    writeStructuredError({
      format: options.format,
      message: "Missing required flag --type",
      code: "INVALID_ARGUMENT",
      hint: `px evaluator update ${evaluatorId} --type llm --description <text>`,
    });
    process.exit(ExitCode.INVALID_ARGUMENT);
  }
  const type = options.type.toLowerCase() as EvaluatorType;
  if (!EVALUATOR_TYPES.includes(type)) {
    writeStructuredError({
      format: options.format,
      message: `Invalid --type '${options.type}'. Must be one of: ${EVALUATOR_TYPES.join(", ")}`,
      code: "INVALID_ARGUMENT",
    });
    process.exit(ExitCode.INVALID_ARGUMENT);
  }
  exitOnFlagsForOtherType({ type, options });
  const fieldFlags = [
    options.name,
    options.description,
    options.outputConfigs,
    options.promptVersionId,
    options.promptVersion,
    options.promptVersionFile,
    options.sandboxConfigId,
    options.inputMapping,
  ];
  if (fieldFlags.every((value) => value === undefined)) {
    writeStructuredError({
      format: options.format,
      message: "Nothing to update: pass at least one field flag",
      code: "INVALID_ARGUMENT",
      hint: `px evaluator update ${evaluatorId} --type ${type} --name <name>`,
    });
    process.exit(ExitCode.INVALID_ARGUMENT);
  }

  try {
    const patch = buildEvaluatorPatch({ type, options });
    const client = createClientOrExit(options);

    writeProgress({
      message: `Updating evaluator ${evaluatorId}...`,
      noProgress: !options.progress,
    });

    const response = await client.PATCH("/v1/evaluators/{evaluator_id}", {
      params: { path: { evaluator_id: evaluatorId } },
      body: patch,
    });
    if (response.error || !response.data) {
      throw new Error(
        `Failed to update evaluator "${evaluatorId}": ${response.error || "Unknown error"}`
      );
    }

    writeOutput({
      message: formatEvaluatorOutput({
        evaluator: response.data.data,
        format: options.format,
      }),
    });
  } catch (error) {
    writeError({
      message: `Error updating evaluator: ${error instanceof Error ? error.message : String(error)}`,
    });
    process.exit(getExitCodeForError(error));
  }
}

/**
 * Handler for `evaluator version create`
 */
async function evaluatorVersionCreateHandler(
  evaluatorId: string,
  options: EvaluatorVersionCreateOptions
): Promise<void> {
  try {
    const sourceCode = readInlineOrFile({
      inline: options.sourceCode,
      inlineFlag: "--source-code",
      file: options.file,
      fileFlag: "--file",
    });

    const client = createClientOrExit(options);

    writeProgress({
      message: `Creating version for evaluator ${evaluatorId}...`,
      noProgress: !options.progress,
    });

    const response = await client.POST(
      "/v1/evaluators/{evaluator_id}/versions",
      {
        params: { path: { evaluator_id: evaluatorId } },
        body: { source_code: sourceCode },
      }
    );
    if (response.error || !response.data) {
      throw new Error(
        `Failed to create evaluator version for "${evaluatorId}": ${response.error || "Unknown error"}`
      );
    }

    writeOutput({
      message: formatEvaluatorVersionOutput({
        version: response.data.data,
        format: options.format,
      }),
    });
  } catch (error) {
    writeError({
      message: `Error creating evaluator version: ${error instanceof Error ? error.message : String(error)}`,
    });
    process.exit(getExitCodeForError(error));
  }
}

export function createEvaluatorGetCommand(): Command {
  return new Command("get")
    .description(
      "Show a shared evaluator definition. Requires Phoenix server >= 21.0.0."
    )
    .argument("<evaluator-id>", "Evaluator ID")
    .option("--endpoint <url>", "Phoenix API endpoint")
    .option("--api-key <key>", "Phoenix API key for authentication")
    .option(
      "--format <format>",
      "Output format: pretty, json, or raw",
      "pretty"
    )
    .option("--no-progress", "Disable progress indicators")
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  # Inspect a definition\n" +
        "  px evaluator get RXZhbHVhdG9yOjE=\n\n" +
        "  # Print a code evaluator's current source (agent-friendly)\n" +
        "  px evaluator get RXZhbHVhdG9yOjI= --format raw --no-progress | jq -r '.source_code'\n"
    )
    .action(evaluatorGetHandler);
}

export function createEvaluatorUpdateCommand(): Command {
  return new Command("update")
    .description(
      "Update a shared evaluator definition; the change applies to every project and dataset that uses it. Requires Phoenix server >= 21.0.0."
    )
    .argument("<evaluator-id>", "Evaluator ID")
    .option("--type <type>", "Evaluator type: llm or code")
    .option("--name <name>", "New name for the evaluator")
    .option("--description <text>", "New description")
    .option(
      "--output-configs <json>",
      "JSON array of output configurations (LLM evaluators accept categorical configs only)"
    )
    .option(
      "--prompt-version-id <id>",
      "(llm) Use an existing prompt version by ID"
    )
    .option(
      "--prompt-version <json>",
      "(llm) Inline prompt version JSON, as printed by `px prompt get --format raw`"
    )
    .option(
      "--prompt-version-file <path>",
      "(llm) Read the prompt version JSON from a file"
    )
    .option(
      "--sandbox-config-id <id>",
      "(code) Sandbox configuration to run the evaluator in"
    )
    .option(
      "--input-mapping <json>",
      '(code) JSON object with "literal_mapping" and "path_mapping" keys'
    )
    .option("--endpoint <url>", "Phoenix API endpoint")
    .option("--api-key <key>", "Phoenix API key for authentication")
    .option(
      "--format <format>",
      "Output format: pretty, json, or raw",
      "pretty"
    )
    .option("--no-progress", "Disable progress indicators")
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  # Rename an LLM evaluator\n" +
        "  px evaluator update RXZhbHVhdG9yOjE= --type llm --name toxicity\n\n" +
        "  # Point an LLM evaluator at a prompt version saved from `px prompt get`\n" +
        "  px prompt get toxicity --format raw --no-progress > prompt.json\n" +
        "  px evaluator update RXZhbHVhdG9yOjE= --type llm --prompt-version-file prompt.json\n\n" +
        "  # Change how a code evaluator reads its inputs\n" +
        '  px evaluator update RXZhbHVhdG9yOjI= --type code --input-mapping \'{"literal_mapping":{},"path_mapping":{"output":"output"}}\'\n'
    )
    .action(evaluatorUpdateHandler);
}

export function createEvaluatorVersionCreateCommand(): Command {
  return new Command("create")
    .description(
      "Append a new immutable version of a code evaluator's source. Requires Phoenix server >= 21.0.0."
    )
    .argument("<evaluator-id>", "Code evaluator ID")
    .option("--source-code <text>", "Full source of the new version, inline")
    .option(
      "--file <path>",
      "Read the full source of the new version from a file"
    )
    .option("--endpoint <url>", "Phoenix API endpoint")
    .option("--api-key <key>", "Phoenix API key for authentication")
    .option(
      "--format <format>",
      "Output format: pretty, json, or raw",
      "pretty"
    )
    .option("--no-progress", "Disable progress indicators")
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  # Push a new version from a file\n" +
        "  px evaluator version create RXZhbHVhdG9yOjI= --file evaluator.py\n\n" +
        "  # Capture the new version ID (agent-friendly)\n" +
        "  px evaluator version create RXZhbHVhdG9yOjI= --file evaluator.py --format raw --no-progress | jq -r '.evaluator_version_id'\n"
    )
    .action(evaluatorVersionCreateHandler);
}

export function createEvaluatorVersionCommand(): Command {
  const command = new Command("version");
  command.description("Manage code evaluator versions");
  command.addCommand(createEvaluatorVersionCreateCommand());
  return command;
}

/**
 * Create the `evaluator` command with subcommands
 */
export function createEvaluatorCommand(): Command {
  const command = new Command("evaluator");
  command.description("Manage shared Phoenix evaluator definitions");
  command.addCommand(createEvaluatorGetCommand());
  command.addCommand(createEvaluatorUpdateCommand());
  command.addCommand(createEvaluatorVersionCommand());
  return command;
}
