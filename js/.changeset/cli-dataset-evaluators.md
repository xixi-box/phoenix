---
"@arizeai/phoenix-cli": minor
---

Add `px dataset evaluator list|get|create|update|delete` for managing the evaluators bound to a dataset (Phoenix server >= 21.0.0). `create` binds an existing evaluator with `--evaluator-id` or creates a new LLM or code evaluator from `--evaluator` JSON or `--evaluator-file`. `delete` accepts several IDs at once, honors `--keep-prompt`, and is gated behind `PHOENIX_CLI_DANGEROUSLY_ENABLE_DELETES` like the other delete verbs.
