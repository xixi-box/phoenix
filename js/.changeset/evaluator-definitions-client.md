---
"@arizeai/phoenix-client": minor
---

Add an `evaluators` subpath with `getEvaluator`, `updateEvaluator`, and `createEvaluatorVersion` for reading and editing shared evaluator definitions over REST (Phoenix server >= 21.0.0). `updateEvaluator` takes a patch discriminated by `type` (`"llm"` or `"code"`) and refuses an empty patch locally. `createEvaluatorVersion` appends an immutable code version and reports `was_created` when the source matches the current version. The `EvaluatorDefinition`, `EvaluatorPatch`, `CodeEvaluatorVersion`, `EvaluatorInputMapping`, and `EvaluatorOutputConfig` types are exported from the same subpath.
