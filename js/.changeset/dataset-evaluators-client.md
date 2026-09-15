---
"@arizeai/phoenix-client": minor
---

Add dataset evaluator bindings to the `evaluators` subpath: `createDatasetEvaluator`, `getDatasetEvaluators`, `getDatasetEvaluator`, `updateDatasetEvaluator`, `deleteDatasetEvaluator`, and `deleteDatasetEvaluators` (Phoenix server >= 21.0.0). Datasets are selected by `datasetId` or `datasetName`; a binding can reference an existing evaluator or create a new LLM or code evaluator in one step. `EvaluatorDefinition` now includes the read-only built-in variant.
