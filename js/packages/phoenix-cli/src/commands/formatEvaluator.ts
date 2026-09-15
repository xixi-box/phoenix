import type { componentsV1 } from "@arizeai/phoenix-client";

import { formatTable } from "./formatTable";

export type OutputFormat = "pretty" | "json" | "raw";

type EvaluatorDefinition =
  componentsV1["schemas"]["EvaluatorDefinitionResponseBody"]["data"];
type CodeEvaluatorVersion = componentsV1["schemas"]["CodeEvaluatorVersion"];

export interface FormatEvaluatorOutputOptions {
  /**
   * Evaluator definition to format.
   */
  evaluator: EvaluatorDefinition;
  /**
   * Output format. Defaults to `"pretty"`.
   */
  format?: OutputFormat;
}

/**
 * Format a shared evaluator definition. `raw`/`json` emit the object directly
 * so agents can extract fields such as `.evaluator_id`; `pretty` renders a
 * single-row table with the fields common to every kind plus the kind's own
 * identifying field.
 */
export function formatEvaluatorOutput({
  evaluator,
  format,
}: FormatEvaluatorOutputOptions): string {
  const selected = format || "pretty";
  if (selected === "raw") {
    return JSON.stringify(evaluator);
  }
  if (selected === "json") {
    return JSON.stringify(evaluator, null, 2);
  }
  return formatTable([evaluatorRow(evaluator)]);
}

function evaluatorRow(evaluator: EvaluatorDefinition): Record<string, unknown> {
  const row: Record<string, unknown> = {
    name: evaluator.name,
    id: evaluator.evaluator_id,
    type: evaluator.type,
    description: evaluator.description ?? "",
  };
  switch (evaluator.type) {
    case "llm":
      row["prompt version"] = evaluator.prompt_version?.id ?? "";
      break;
    case "code":
      row.language = evaluator.language;
      row.version = evaluator.evaluator_version_id ?? "";
      break;
    default:
      break;
  }
  return row;
}

export interface FormatEvaluatorVersionOutputOptions {
  /**
   * Code evaluator version to format.
   */
  version: CodeEvaluatorVersion;
  /**
   * Output format. Defaults to `"pretty"`.
   */
  format?: OutputFormat;
}

/**
 * Format a code evaluator version. `pretty` omits the source, which can be
 * long; use `json` or `raw` to see it.
 */
export function formatEvaluatorVersionOutput({
  version,
  format,
}: FormatEvaluatorVersionOutputOptions): string {
  const selected = format || "pretty";
  if (selected === "raw") {
    return JSON.stringify(version);
  }
  if (selected === "json") {
    return JSON.stringify(version, null, 2);
  }
  return formatTable([
    {
      "evaluator id": version.evaluator_id,
      "version id": version.evaluator_version_id,
      created: version.was_created ? "yes" : "no (source unchanged)",
    },
  ]);
}
