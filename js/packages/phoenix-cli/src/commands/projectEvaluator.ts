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
import { parseNumberOption, parsePositiveIntOption } from "../optionParsers";
import { writeStructuredError } from "../structuredError";
import { parseJsonObjectFlag, readInlineOrFile } from "./evaluatorInputs";
import {
  formatProjectEvaluatorOutput,
  formatProjectEvaluatorsOutput,
  type OutputFormat,
} from "./formatProjectEvaluator";
import type { CommonOptions, DeleteOptions } from "./options";

type ProjectEvaluator = componentsV1["schemas"]["ProjectEvaluator"];
type CreateRequest = componentsV1["schemas"]["CreateProjectEvaluatorRequest"];
type PatchRequest = componentsV1["schemas"]["PatchProjectEvaluatorRequest"];
type InputMapping = componentsV1["schemas"]["InputMapping"];
type EvaluatorInput = CreateRequest["evaluator"];
type EvaluationTarget = CreateRequest["evaluation_target"];

const EVALUATION_TARGETS = ["SPAN", "TRACE", "SESSION"] as const;

/**
 * Options for `px project evaluator list <project-identifier>`.
 */
interface ProjectEvaluatorListOptions extends CommonOptions<OutputFormat> {
  /**
   * `--limit <number>`: Maximum number of bindings to fetch. Defaults to
   * fetching every page.
   *
   * @example 50
   */
  limit?: number;
}

/**
 * Options for `px project evaluator get <project-evaluator-id>`.
 */
type ProjectEvaluatorGetOptions = CommonOptions<OutputFormat>;

/**
 * Scheduling flags shared by create and update.
 */
interface ProjectEvaluatorFieldOptions extends CommonOptions<OutputFormat> {
  /**
   * `--name <name>`: The binding's name, unique within the project.
   *
   * @example "toxicity"
   */
  name?: string;
  /**
   * `--sampling-rate <number>`: Fraction of matching records to evaluate,
   * between 0 and 1.
   *
   * @example 0.25
   */
  samplingRate?: number;
  /**
   * `--filter-condition <expr>`: Span filter expression records must match.
   *
   * @example "span_kind == 'LLM'"
   */
  filterCondition?: string;
  /**
   * `--enabled` / `--disabled`: Whether the binding is active. Commander
   * leaves this undefined when neither flag is passed.
   */
  enabled?: boolean;
  /**
   * `--input-mapping <json>`: JSON object with `literal_mapping` and
   * `path_mapping` keys mapping record fields onto evaluator arguments.
   */
  inputMapping?: string;
  /**
   * `--evaluation-delay-seconds <number>`: For TRACE and SESSION targets, how
   * long the trace or session must be quiet before it is evaluated. Rejected
   * for SPAN targets.
   *
   * @example 600
   */
  evaluationDelaySeconds?: number;
}

/**
 * Options for `px project evaluator create <project-identifier>`. Exactly one
 * of `--evaluator-id`, `--evaluator`, or `--evaluator-file` selects the
 * evaluator.
 */
interface ProjectEvaluatorCreateOptions extends ProjectEvaluatorFieldOptions {
  /**
   * `--evaluation-target <SPAN|TRACE|SESSION>`: What the evaluator runs on.
   * Required.
   */
  evaluationTarget?: string;
  /**
   * `--evaluator-id <id>`: Bind an existing code evaluator.
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
 * Options for `px project evaluator update <project-evaluator-id>`.
 */
type ProjectEvaluatorUpdateOptions = ProjectEvaluatorFieldOptions;

/**
 * Options for `px project evaluator delete <project-evaluator-id...>`.
 */
interface ProjectEvaluatorDeleteOptions extends DeleteOptions {
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

async function fetchProjectEvaluators(
  client: PhoenixClient,
  projectIdentifier: string,
  options: { limit?: number } = {}
): Promise<ProjectEvaluator[]> {
  const bindings: ProjectEvaluator[] = [];
  let cursor: string | undefined;
  const pageLimit = options.limit || 100;

  do {
    const response = await client.GET(
      "/v1/projects/{project_identifier}/evaluators",
      {
        params: {
          path: { project_identifier: projectIdentifier },
          query: { cursor, limit: pageLimit },
        },
      }
    );
    if (response.error || !response.data) {
      throw new Error(
        `Failed to fetch evaluators for project "${projectIdentifier}": ${response.error || "Unknown error"}`
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
 * Handler for `project evaluator list`
 */
async function projectEvaluatorListHandler(
  projectIdentifier: string,
  options: ProjectEvaluatorListOptions
): Promise<void> {
  try {
    const client = createClientOrExit(options);

    writeProgress({
      message: `Fetching evaluators for project "${projectIdentifier}"...`,
      noProgress: !options.progress,
    });

    const bindings = await fetchProjectEvaluators(client, projectIdentifier, {
      limit: options.limit,
    });

    writeProgress({
      message: `Found ${bindings.length} project evaluator(s)`,
      noProgress: !options.progress,
    });

    writeOutput({
      message: formatProjectEvaluatorsOutput({
        bindings,
        format: options.format,
      }),
    });
  } catch (error) {
    writeError({
      message: `Error fetching project evaluators: ${error instanceof Error ? error.message : String(error)}`,
    });
    process.exit(getExitCodeForError(error));
  }
}

/**
 * Handler for `project evaluator get`
 */
async function projectEvaluatorGetHandler(
  projectEvaluatorId: string,
  options: ProjectEvaluatorGetOptions
): Promise<void> {
  try {
    const client = createClientOrExit(options);

    writeProgress({
      message: `Fetching project evaluator ${projectEvaluatorId}...`,
      noProgress: !options.progress,
    });

    const response = await client.GET(
      "/v1/project_evaluators/{project_evaluator_id}",
      { params: { path: { project_evaluator_id: projectEvaluatorId } } }
    );
    if (response.error || !response.data) {
      throw new Error(
        `Failed to fetch project evaluator "${projectEvaluatorId}": ${response.error || "Unknown error"}`
      );
    }

    writeOutput({
      message: formatProjectEvaluatorOutput({
        binding: response.data.data,
        format: options.format,
      }),
    });
  } catch (error) {
    writeError({
      message: `Error fetching project evaluator: ${error instanceof Error ? error.message : String(error)}`,
    });
    process.exit(getExitCodeForError(error));
  }
}

/**
 * Resolve the evaluator to bind from whichever flag the caller supplied.
 * Callers validate that exactly one form is present before calling.
 */
function resolveEvaluatorInput(
  options: ProjectEvaluatorCreateOptions
): EvaluatorInput {
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
 * Handler for `project evaluator create`
 */
async function projectEvaluatorCreateHandler(
  projectIdentifier: string,
  options: ProjectEvaluatorCreateOptions
): Promise<void> {
  // Argument-shape validation runs before the try block so its `process.exit`
  // isn't caught and re-mapped by the catch-all error handler below.
  const usage = `px project evaluator create ${projectIdentifier} --name <name> --evaluation-target SPAN --sampling-rate 1 --evaluator-id <id>`;
  if (!options.name) {
    writeStructuredError({
      format: options.format,
      message: "Missing required flag --name",
      code: "INVALID_ARGUMENT",
      hint: usage,
    });
    process.exit(ExitCode.INVALID_ARGUMENT);
  }
  if (!options.evaluationTarget) {
    writeStructuredError({
      format: options.format,
      message: "Missing required flag --evaluation-target",
      code: "INVALID_ARGUMENT",
      hint: usage,
    });
    process.exit(ExitCode.INVALID_ARGUMENT);
  }
  const evaluationTarget =
    options.evaluationTarget.toUpperCase() as EvaluationTarget;
  if (!EVALUATION_TARGETS.includes(evaluationTarget)) {
    writeStructuredError({
      format: options.format,
      message: `Invalid --evaluation-target '${options.evaluationTarget}'. Must be one of: ${EVALUATION_TARGETS.join(", ")}`,
      code: "INVALID_ARGUMENT",
    });
    process.exit(ExitCode.INVALID_ARGUMENT);
  }
  if (options.samplingRate === undefined) {
    writeStructuredError({
      format: options.format,
      message: "Missing required flag --sampling-rate",
      code: "INVALID_ARGUMENT",
      hint: usage,
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
      hint: usage,
    });
    process.exit(ExitCode.INVALID_ARGUMENT);
  }

  try {
    const body: CreateRequest = {
      name: options.name,
      evaluation_target: evaluationTarget,
      sampling_rate: options.samplingRate,
      evaluator: resolveEvaluatorInput(options),
    };
    if (options.filterCondition !== undefined) {
      body.filter_condition = options.filterCondition;
    }
    if (options.enabled !== undefined) {
      body.enabled = options.enabled;
    }
    if (options.inputMapping !== undefined) {
      body.input_mapping = parseJsonObjectFlag<InputMapping>({
        flag: "--input-mapping",
        value: options.inputMapping,
      });
    }
    if (options.evaluationDelaySeconds !== undefined) {
      body.evaluation_delay_seconds = options.evaluationDelaySeconds;
    }

    const client = createClientOrExit(options);

    writeProgress({
      message: `Binding evaluator to project "${projectIdentifier}"...`,
      noProgress: !options.progress,
    });

    const response = await client.POST(
      "/v1/projects/{project_identifier}/evaluators",
      {
        params: { path: { project_identifier: projectIdentifier } },
        body,
      }
    );
    if (response.error || !response.data) {
      throw new Error(
        `Failed to create project evaluator: ${response.error || "Unknown error"}`
      );
    }

    writeOutput({
      message: formatProjectEvaluatorOutput({
        binding: response.data.data,
        format: options.format,
      }),
    });
  } catch (error) {
    writeError({
      message: `Error creating project evaluator: ${error instanceof Error ? error.message : String(error)}`,
    });
    process.exit(getExitCodeForError(error));
  }
}

/**
 * Handler for `project evaluator update`
 */
async function projectEvaluatorUpdateHandler(
  projectEvaluatorId: string,
  options: ProjectEvaluatorUpdateOptions
): Promise<void> {
  const fieldFlags = [
    options.name,
    options.samplingRate,
    options.filterCondition,
    options.enabled,
    options.inputMapping,
    options.evaluationDelaySeconds,
  ];
  if (fieldFlags.every((value) => value === undefined)) {
    writeStructuredError({
      format: options.format,
      message: "Nothing to update: pass at least one field flag",
      code: "INVALID_ARGUMENT",
      hint: `px project evaluator update ${projectEvaluatorId} --disabled`,
    });
    process.exit(ExitCode.INVALID_ARGUMENT);
  }

  try {
    const body: PatchRequest = {};
    if (options.name !== undefined) {
      body.name = options.name;
    }
    if (options.samplingRate !== undefined) {
      body.sampling_rate = options.samplingRate;
    }
    if (options.filterCondition !== undefined) {
      body.filter_condition = options.filterCondition;
    }
    if (options.enabled !== undefined) {
      body.enabled = options.enabled;
    }
    if (options.inputMapping !== undefined) {
      body.input_mapping = parseJsonObjectFlag<InputMapping>({
        flag: "--input-mapping",
        value: options.inputMapping,
      });
    }
    if (options.evaluationDelaySeconds !== undefined) {
      body.evaluation_delay_seconds = options.evaluationDelaySeconds;
    }

    const client = createClientOrExit(options);

    writeProgress({
      message: `Updating project evaluator ${projectEvaluatorId}...`,
      noProgress: !options.progress,
    });

    const response = await client.PATCH(
      "/v1/project_evaluators/{project_evaluator_id}",
      {
        params: { path: { project_evaluator_id: projectEvaluatorId } },
        body,
      }
    );
    if (response.error || !response.data) {
      throw new Error(
        `Failed to update project evaluator "${projectEvaluatorId}": ${response.error || "Unknown error"}`
      );
    }

    writeOutput({
      message: formatProjectEvaluatorOutput({
        binding: response.data.data,
        format: options.format,
      }),
    });
  } catch (error) {
    writeError({
      message: `Error updating project evaluator: ${error instanceof Error ? error.message : String(error)}`,
    });
    process.exit(getExitCodeForError(error));
  }
}

/**
 * Handler for `project evaluator delete`
 */
async function projectEvaluatorDeleteHandler(
  projectEvaluatorIds: string[],
  options: ProjectEvaluatorDeleteOptions
): Promise<void> {
  try {
    assertDeletesEnabled();

    const client = createClientOrExit(options);

    const noun =
      projectEvaluatorIds.length === 1
        ? `project evaluator ${projectEvaluatorIds[0]}`
        : `${projectEvaluatorIds.length} project evaluators`;
    await confirmOrExit({
      message: `Delete ${noun}? This removes the binding and its evaluator traces. This cannot be undone.`,
      yes: options.yes,
    });

    const deleteAssociatedPrompt = !options.keepPrompt;
    const response =
      projectEvaluatorIds.length === 1
        ? await client.DELETE("/v1/project_evaluators/{project_evaluator_id}", {
            params: {
              path: { project_evaluator_id: projectEvaluatorIds[0] },
              query: { delete_associated_prompt: deleteAssociatedPrompt },
            },
          })
        : await client.DELETE("/v1/project_evaluators", {
            params: {
              query: {
                project_evaluator_ids: projectEvaluatorIds,
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
      message: `Error deleting project evaluator: ${error instanceof Error ? error.message : String(error)}`,
    });
    process.exit(getExitCodeForError(error));
  }
}

function addSchedulingOptions(command: Command): Command {
  return command
    .option("--name <name>", "Binding name, unique within the project")
    .option(
      "--sampling-rate <number>",
      "Fraction of matching records to evaluate, between 0 and 1",
      parseNumberOption
    )
    .option(
      "--filter-condition <expr>",
      "Span filter expression records must match"
    )
    .option("--enabled", "Activate the binding")
    .option("--disabled", "Deactivate the binding without deleting it")
    .option(
      "--input-mapping <json>",
      'JSON object with "literal_mapping" and "path_mapping" keys'
    )
    .option(
      "--evaluation-delay-seconds <number>",
      "For TRACE and SESSION targets, quiet period before the trace or session is evaluated",
      parsePositiveIntOption
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

/**
 * Commander stores `--enabled` and `--disabled` as two booleans. Collapse them
 * into the single `enabled` field the handlers read, rejecting both at once.
 */
function collapseEnabledFlags(
  options: ProjectEvaluatorFieldOptions & { disabled?: boolean }
): void {
  if (options.enabled && options.disabled) {
    writeStructuredError({
      format: options.format,
      message: "--enabled and --disabled cannot be used together",
      code: "INVALID_ARGUMENT",
    });
    process.exit(ExitCode.INVALID_ARGUMENT);
  }
  if (options.disabled) {
    options.enabled = false;
  }
  delete options.disabled;
}

export function createProjectEvaluatorListCommand(): Command {
  return addCommonReadOptions(
    new Command("list")
      .description(
        "List the evaluators bound to a project. Requires Phoenix server >= 21.0.0."
      )
      .argument("<project-identifier>", "Project name or ID")
      .option(
        "--limit <number>",
        "Maximum number of bindings to fetch",
        parseInt
      )
  )
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  px project evaluator list support-bot\n" +
        "  px project evaluator list support-bot --format raw --no-progress | jq -r '.[] | select(.enabled) | .project_evaluator_id'\n"
    )
    .action(projectEvaluatorListHandler);
}

export function createProjectEvaluatorGetCommand(): Command {
  return addCommonReadOptions(
    new Command("get")
      .description(
        "Show a project evaluator binding. Requires Phoenix server >= 21.0.0."
      )
      .argument("<project-evaluator-id>", "Project evaluator ID")
  ).action(projectEvaluatorGetHandler);
}

export function createProjectEvaluatorCreateCommand(): Command {
  return addCommonReadOptions(
    addSchedulingOptions(
      new Command("create")
        .description(
          "Bind an evaluator to a project so it runs on incoming traces, creating the evaluator if needed. Requires Phoenix server >= 21.0.0."
        )
        .argument("<project-identifier>", "Project name or ID")
        .option(
          "--evaluation-target <target>",
          "What the evaluator runs on: SPAN, TRACE, or SESSION"
        )
        .option("--evaluator-id <id>", "Bind an existing code evaluator")
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
        "  # Evaluate a quarter of LLM spans with an existing evaluator\n" +
        "  px project evaluator create support-bot --name toxicity --evaluation-target SPAN --sampling-rate 0.25 --evaluator-id RXZhbHVhdG9yOjE= --filter-condition \"span_kind == 'LLM'\"\n\n" +
        "  # Evaluate whole sessions ten minutes after they go quiet\n" +
        "  px project evaluator create support-bot --name resolution --evaluation-target SESSION --sampling-rate 1 --evaluator-file resolution.json --evaluation-delay-seconds 600\n\n" +
        "  # Capture the new binding ID (agent-friendly)\n" +
        "  px project evaluator create support-bot --name toxicity --evaluation-target SPAN --sampling-rate 1 --evaluator-id RXZhbHVhdG9yOjE= --format raw --no-progress | jq -r '.project_evaluator_id'\n"
    )
    .action(
      (
        projectIdentifier: string,
        options: ProjectEvaluatorCreateOptions & { disabled?: boolean }
      ) => {
        collapseEnabledFlags(options);
        return projectEvaluatorCreateHandler(projectIdentifier, options);
      }
    );
}

export function createProjectEvaluatorUpdateCommand(): Command {
  return addCommonReadOptions(
    addSchedulingOptions(
      new Command("update")
        .description(
          "Update a project evaluator binding; only the flags you pass are changed. Requires Phoenix server >= 21.0.0."
        )
        .argument("<project-evaluator-id>", "Project evaluator ID")
    )
  )
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  # Pause a binding without deleting it\n" +
        "  px project evaluator update UHJvamVjdEV2YWx1YXRvcjox --disabled\n\n" +
        "  # Sample more traffic\n" +
        "  px project evaluator update UHJvamVjdEV2YWx1YXRvcjox --sampling-rate 0.5\n"
    )
    .action(
      (
        projectEvaluatorId: string,
        options: ProjectEvaluatorUpdateOptions & { disabled?: boolean }
      ) => {
        collapseEnabledFlags(options);
        return projectEvaluatorUpdateHandler(projectEvaluatorId, options);
      }
    );
}

export function createProjectEvaluatorDeleteCommand(): Command {
  return new Command("delete")
    .description(
      "Delete one or more project evaluator bindings. Requires Phoenix server >= 21.0.0."
    )
    .argument("<project-evaluator-id...>", "Project evaluator ID(s)")
    .option(
      "--keep-prompt",
      "Keep the prompt of an LLM evaluator that becomes unreferenced"
    )
    .option("--endpoint <url>", "Phoenix API endpoint")
    .option("--api-key <key>", "Phoenix API key for authentication")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--no-progress", "Disable progress indicators")
    .action(projectEvaluatorDeleteHandler);
}

/**
 * Create the `project evaluator` command with subcommands
 */
export function createProjectEvaluatorCommand(): Command {
  const command = new Command("evaluator");
  command.description("Manage evaluators that run on a project's traces");
  command.addCommand(createProjectEvaluatorListCommand());
  command.addCommand(createProjectEvaluatorGetCommand());
  command.addCommand(createProjectEvaluatorCreateCommand());
  command.addCommand(createProjectEvaluatorUpdateCommand());
  command.addCommand(createProjectEvaluatorDeleteCommand());
  return command;
}
