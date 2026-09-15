import type {
  CodeEvaluatorDefinition,
  LLMEvaluatorDefinition,
} from "../../src/types/evaluators";

export const EVALUATOR_ID = "RXZhbHVhdG9yOjE=";

export const llmDefinition: LLMEvaluatorDefinition = {
  type: "llm",
  evaluator_id: EVALUATOR_ID,
  name: "toxicity",
  description: null,
  prompt_version: null,
  output_configs: [
    {
      type: "CATEGORICAL",
      name: "toxicity",
      optimization_direction: "MINIMIZE",
      values: [
        { label: "toxic", score: 1 },
        { label: "clean", score: 0 },
      ],
    },
  ],
};

export const codeDefinition: CodeEvaluatorDefinition = {
  type: "code",
  evaluator_id: EVALUATOR_ID,
  name: "exact-match",
  description: null,
  language: "PYTHON",
  sandbox_config_id: "U2FuZGJveENvbmZpZzox",
  input_mapping: { literal_mapping: {}, path_mapping: { output: "output" } },
  output_configs: [],
  evaluator_version_id: "Q29kZUV2YWx1YXRvclZlcnNpb246MQ==",
  source_code: "def evaluate(output: str) -> float:\n    return 1.0\n",
};
