---
"@arizeai/phoenix-cli": minor
---

Add `px evaluator get`, `px evaluator update`, and `px evaluator version create` for reading and editing shared evaluator definitions (Phoenix server >= 21.0.0). `update` takes `--type llm|code` plus only the field flags you want to change, accepts prompt versions inline or from a file, and rejects flags that belong to the other kind before calling the server. `version create` appends an immutable code version from `--file` or `--source-code`.
