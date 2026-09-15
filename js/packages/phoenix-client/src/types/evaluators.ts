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
