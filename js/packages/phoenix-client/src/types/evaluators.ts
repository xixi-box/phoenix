import type { components } from "../__generated__/api/v1";

/**
 * A shared evaluator definition as returned by the Phoenix REST API. The
 * `type` field discriminates the variants.
 */
export type EvaluatorDefinition =
  components["schemas"]["EvaluatorDefinitionResponseBody"]["data"];

/**
 * A shared LLM evaluator definition.
 */
export type LLMEvaluatorDefinition =
  components["schemas"]["LLMEvaluatorDefinition"];

/**
 * A shared code evaluator definition.
 */
export type CodeEvaluatorDefinition =
  components["schemas"]["CodeEvaluatorDefinition"];

/**
 * One immutable version of a code evaluator's source.
 */
export type CodeEvaluatorVersion =
  components["schemas"]["CodeEvaluatorVersion"];

/**
 * Fields that can change on a shared LLM evaluator. Omitted fields keep their
 * current values.
 */
export type LLMEvaluatorPatch =
  components["schemas"]["PatchLLMEvaluatorRequest"];

/**
 * Fields that can change on a shared code evaluator. Omitted fields keep
 * their current values.
 */
export type CodeEvaluatorPatch =
  components["schemas"]["PatchCodeEvaluatorRequest"];

/**
 * A patch for a shared evaluator definition. `type` selects the variant and
 * must match the evaluator being updated.
 */
export type EvaluatorPatch = LLMEvaluatorPatch | CodeEvaluatorPatch;

/**
 * How record fields map onto evaluator arguments.
 */
export type EvaluatorInputMapping = components["schemas"]["InputMapping"];

/**
 * An output configuration an evaluator can produce.
 */
export type EvaluatorOutputConfig =
  CodeEvaluatorDefinition["output_configs"][number];

/**
 * A binding between a dataset and an evaluator, as returned by the Phoenix
 * REST API.
 */
export type DatasetEvaluator = components["schemas"]["DatasetEvaluator"];

/**
 * A new LLM evaluator to create alongside a binding.
 */
export type NewLLMEvaluator = components["schemas"]["NewLLMEvaluator"];

/**
 * A new code evaluator to create alongside a binding.
 */
export type NewCodeEvaluator = components["schemas"]["NewCodeEvaluator"];

/**
 * The evaluator a dataset binding creates or references: a new LLM or code
 * evaluator, or `{ type: "reference", evaluator_id }` for an existing one.
 */
export type DatasetEvaluatorInput =
  components["schemas"]["CreateDatasetEvaluatorRequest"]["evaluator"];

/**
 * Fields that can change on a dataset binding. Omitted fields keep their
 * current values.
 */
export type DatasetEvaluatorPatch =
  components["schemas"]["PatchDatasetEvaluatorRequest"];

/**
 * Identifies a dataset by ID or by name. The server accepts either in the
 * `dataset_identifier` path parameter.
 */
export type DatasetIdentifier = { datasetId: string } | { datasetName: string };

/**
 * Resolves a {@link DatasetIdentifier} to the string the REST
 * `dataset_identifier` path parameter expects.
 */
export function resolveDatasetIdentifier(
  identifier: DatasetIdentifier
): string {
  if ("datasetId" in identifier) return identifier.datasetId;
  return identifier.datasetName;
}

/**
 * A binding that runs an evaluator on a project's incoming traces, as
 * returned by the Phoenix REST API.
 */
export type ProjectEvaluator = components["schemas"]["ProjectEvaluator"];

/**
 * What a project evaluator runs on. `SPAN` evaluators run on matching sampled
 * spans. `TRACE` and `SESSION` evaluators run once per trace or session, after
 * the first quiet period following the evaluation delay.
 */
export type EvaluationTarget = components["schemas"]["EvaluationTarget"];

/**
 * The evaluator a project binding creates or references: a new LLM or code
 * evaluator, or `{ type: "reference", evaluator_id }` for an existing code
 * evaluator.
 */
export type ProjectEvaluatorInput =
  components["schemas"]["CreateProjectEvaluatorRequest"]["evaluator"];

/**
 * Fields that can change on a project binding. Omitted fields keep their
 * current values.
 */
export type ProjectEvaluatorPatch =
  components["schemas"]["PatchProjectEvaluatorRequest"];
