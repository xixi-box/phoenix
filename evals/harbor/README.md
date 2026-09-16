# Harbor evaluations for Phoenix

Harbor tasks and tooling for evaluating agents against Phoenix. Harbor runs the agents
and the verifiers. The `arize-phoenix` Harbor plugin writes the results to a Phoenix of
your choice as versioned datasets, experiments, scores, and ATIF traces.

This directory holds two suites. The [Phoenix tool benchmark](#phoenix-tool-benchmark)
compares every surface an agent can use to reach Phoenix, on the same fixtures: the MCP
server, the `px` CLI, and PXI itself. The [PXI tasks](#pxi-tasks) are multi-step
scenarios for PXI and Claude Code on hand-prepared fixtures.

## Phoenix tool benchmark

Every trial runs in one container built from `environment/Dockerfile`: a Phoenix from
this checkout serving a database pre-seeded with the
[PatronusAI/TRAIL](https://huggingface.co/datasets/PatronusAI/TRAIL) traces and
annotations, Claude Code, Codex, `px`, and the verifier. The agent answers a question
about the seeded project, and the task's verifier grades the agent's final reply while
that Phoenix is still up. The plugin then records the trial in whichever Phoenix you
point it at. The same image runs on local Docker and on Daytona.

```text
environment/          The shared Dockerfile; make harbor-stage adds the wheel, database, and lib
experiments/          One Harbor job file per split, listing every condition
lib/                  Grading helpers used by task verifiers (pure Python, unit-tested)
scripts/              TRAIL download, seeding, staging, and job-file selection
tasks/dev/<task>/     Development tasks: instruction, task.toml, tests/, solution/
tasks/test/<task>/    Held-out tasks, same layout (empty until needed)
```

### Requirements

- Docker whose Linux VM supports Harbor's allowlist network policy. Recent Docker
  Desktop builds do. Harbor probes the kernel before starting and refuses to run if the
  feature is missing, and its docs suggest OrbStack or a Linux host in that case.
- `uv`. The launcher gets its own Python 3.13 environment under `.venv/` here on first
  use, because Harbor needs Python 3.12 or newer and the repository runs on 3.10.
- A Hugging Face token with the TRAIL terms accepted, for the one-time seed download.
  TRAIL's terms forbid resharing it outside the Hugging Face hub. The rows stay in a
  local cache, and the seeded database goes only into the task build contexts, never to
  a registry or a bucket. On Daytona the built image lives in an auto-snapshot of your
  Daytona organization; treat that like the local Docker image.
- A running Phoenix to receive results. The plugin reads `PHOENIX_COLLECTOR_ENDPOINT`
  and `PHOENIX_API_KEY` and defaults to `http://localhost:6006`.
- `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` for the paid conditions, and `DAYTONA_API_KEY`
  for `ENV=daytona`.

### First time

```sh
HF_TOKEN=... make harbor-seed     # download TRAIL rows to evals/harbor/.cache
make harbor-stage                 # build the wheel, seed the database, stage every task
make harbor-bench-oracle          # run every reference solution through the verifiers
```

`make harbor-stage` builds the Phoenix wheel from this checkout, uncommitted changes
included. The first time, it also seeds the database: a throwaway image starts Phoenix,
the repository's TRAIL loader pushes the rows through the public client, the script
waits until the API reports every trace and its computed cost, checkpoints the SQLite
write-ahead log, and the database is copied out. Later runs reuse the staged database;
pass `RESEED=1` after a change that affects ingestion. `PX_VERSION` picks the `px`
release the image installs (default `1.18.2`).

Staging writes `wheels/`, `data/`, `lib/`, `container_assets/`, and `px-version` next
to the Dockerfile, then copies the whole directory into each task's `environment/` with
hard links, because Harbor builds a task's image from that task's own directory and
Docker cannot follow symlinks out of a build context. Those copies are ignored by git and
by the task's `.gitignore`, which Harbor also applies when it hashes the task, so staging
never changes the dataset version. The dataset version covers the instruction, the
verifier, and the reference solution; the image is the thing under test.

Restage whenever the server, `lib/`, `container_assets/`, or a pinned tool version
changes. Forgetting it is the most likely way to get a confusing verifier error, because
the verifier imports `lib/` from the image, not from your checkout.

### Every run

```sh
make harbor-bench AGENTS=claude-mcp                          # one condition, whole dev split
make harbor-bench AGENTS="claude-cli codex-cli" TASKS="count-traces total-cost" REPS=3
make harbor-bench                                            # every condition in experiments/dev.yaml
make harbor-bench AGENTS=oracle ENV=daytona                  # same job on Daytona
make harbor-bench AGENTS=claude-cli SPLIT=test NAME=cli-1.18.2-candidate
```

| Variable | Meaning | Default |
| --- | --- | --- |
| `AGENTS` | condition names from `experiments/<split>.yaml`, space-separated | all of them |
| `SPLIT` | task directory under `tasks/`; also names the Phoenix dataset `phoenix-tools-<split>` | `dev` |
| `TASKS` | space-separated task names to include | all in the split |
| `REPS` | attempts per task | `1` |
| `ENV` | Harbor environment: `docker` or `daytona` | `docker` |
| `NAME` | Harbor job name and the experiment name prefix; a new name starts new experiments | `<split>-<timestamp>` |

Each invocation is one Harbor job. The plugin creates one Phoenix experiment per
condition, named `<NAME> · <condition>`, on the split's dataset. `harbor-bench` writes
the selected conditions to a job file under `.cache/jobs/` and prints the underlying
`harbor run` command, so you can also call `evals/harbor/.venv/bin/harbor` directly with
any other Harbor flags. Harbor's own `-a` flag is not a way to pick a condition: it
replaces the job's agents with a bare entry and drops the MCP servers, environment, and
skills that define one.

### Conditions

`experiments/dev.yaml` lists every condition. Each is a stock Harbor agent under a
condition name: Harbor keeps `name` as a label when it is not a registered agent name and
`import_path` names the class.

| Condition | Agent | Reaches Phoenix through |
| --- | --- | --- |
| `claude-mcp` | Claude Code | the MCP server at `http://127.0.0.1:6006/mcp` |
| `claude-cli` | Claude Code | `px` on its `PATH`, `PHOENIX_ENDPOINT` set, and the public `phoenix-cli` skill |
| `codex-mcp` | Codex | the MCP server |
| `codex-cli` | Codex | `px`, `PHOENIX_ENDPOINT`, and the public skill |
| `pxi` | PXI inside the Phoenix server | the agent session chat route, through `agents/phoenix_chat_agent.py` |
| `oracle` | none | the reference solution, run through the verifier without model calls |

`px` is installed in the image under `/opt/px/bin`, off the `PATH`, and only the `px`
executable is exposed there, not `pxi`. CLI conditions add that directory to their
`PATH` in their agent entry; MCP conditions never see it. The `pxi` condition needs the
server started with PXI enabled, which the server decides once at start from
`PHOENIX_DISABLE_AGENT_ASSISTANT` in the host environment: `make harbor-bench` sets it to
`false` whenever `pxi` is among the selected conditions (or when running the whole file)
and to `true` otherwise. A job that includes `pxi` therefore runs every condition with PXI
enabled; the coding agents cannot reach it because `pxi` is not on their `PATH`.

The web search and fetch tools are disabled for both coding agents. Every condition sees
the same task instruction; there is no per-condition hint text.

### Inside a trial

Harbor starts the container with its own keepalive command and then runs the task's
`[environment.healthcheck]`, which is `container_assets/start_phoenix_server.sh`. The
script is idempotent: it starts Phoenix on `/data/phoenix.db` if nothing answers on port
6006 and waits until it does. Running Phoenix from the healthcheck rather than the image
entrypoint works the same on Docker and Daytona, and Harbor does not begin agent setup
until it passes.

Every task sets Harbor's allowlist network policy with no hosts of its own. Hosts are
granted at the narrowest level that needs them (see [Network allowlists](#network-allowlists)):
the job file grants the Phoenix docs hosts to every trial, and each condition grants its
own LLM provider for its run phase. The oracle grants nothing. Because the agent and
Phoenix share one container, the agent reaches Phoenix at `http://127.0.0.1:6006`. An
MCP agent can still call Phoenix over plain HTTP on that port; the reward checks only the
answer, not the interface used.

Verification runs in Harbor's shared mode. After the agent finishes, Harbor uploads the
agent's log directory, including the ATIF `trajectory.json` it wrote for the agent, and
the task's `tests/` into the container, and runs `test.sh` there with Phoenix still up.
The verifier reads the agent's final reply from `/logs/agent/trajectory.json`. The
oracle runs a solution script instead of an agent and so has no trajectory; it writes
`/workspace/answer.txt`, which the grader reads only when no trajectory exists.

### What lands in Phoenix

- One dataset per split, versioned by the selected task content. Runs share a dataset
  version only when they use the same `SPLIT` and `TASKS` selection.
- One experiment per condition and `NAME`.
- On each run, Harbor's token counts, cost, and latency, an `infra_ok` evaluation that
  is `0` when Harbor recorded any exception, and the agent's ATIF trace.
- From the verifier, `reward` (0 or 1), `tool_call_count`, and `agent_turn_count`. The
  two counts come from the ATIF trajectory. The oracle has no trajectory, so its runs
  omit them.

For the current tasks, `reward` is the final correctness score: `1` when the answer
matcher passes and `0` when it fails. Tool-call and turn counts are separate efficiency
measurements. They do not change `reward`. The plugin also adds `infra_ok` as a separate
execution-health score; Phoenix records these values but does not combine or recalculate
them.

To export PXI's own traces to a results Phoenix as well, set
`HARBOR_PHOENIX_COLLECTOR_ENDPOINT` (and `HARBOR_PHOENIX_API_KEY`) in the host environment
and grant the collector host to the trial, for example by adding it to
`environment.extra_allowed_hosts` in the job file. From Docker the host is
`host.docker.internal`, not `localhost`.

### Adding a task

```text
tasks/dev/<name>/
  instruction.md                 the prompt, nothing about where to put the answer
  task.toml                      identical across tasks (network policy, healthcheck, timeouts)
  .gitignore                     identical across tasks: ignores the staged environment/
  tests/test.sh                  the verifier entry point
  tests/expected.json            the reference, for answer tasks
  solution/solve.sh              a reference solution through px, run by the oracle
```

Reference solutions in Python import `evals.harbor.lib.phoenix_query` from
`/opt/verifier`, which fetches a project's spans through `px`. `task.toml`,
`.gitignore`, and `tests/test.sh` are identical across tasks; a unit test checks that
they stay that way. Run `make harbor-stage` after adding a task so it gets its
`environment/`.

For a question with a checkable answer, `test.sh` calls the shared grader and
`expected.json` defines the comparison. These are the supported forms:

```json
{"kind": "integer", "value": 117, "aliases": ["traces"]}
{"kind": "number", "value": 16.0022, "places": 2, "aliases": ["cost", "total"]}
{"kind": "number", "value": [45.32, 43.05], "places": 1}
{"kind": "labeled_number", "places": 1, "labels": {"short": {"aliases": ["short", "<15"], "value": 0.79}, "long": {"aliases": ["long", "40+"], "value": 14.61}}}
{"kind": "entity_count", "aliases": ["FinderTool"], "value": 24}
{"kind": "name", "aliases": [["PageDownTool", "page_down"]]}
{"kind": "name", "aliases": [["forward"], ["keyword argument", "TypeError"]], "require_all": true, "allow_hedging": true}
{"kind": "exact", "value": "ok"}
{"kind": "all", "checks": [{"kind": "name", "aliases": [["FinderTool"]]}, {"kind": "integer", "value": 24}]}
```

A value list accepts any listed value unless `require_all` is `true`. The matchers
remove Markdown emphasis and normalize whitespace before comparing. Integer, number,
and name checks reject phrases such as "117 or 118" and "about 117". Name checks can
set `allow_hedging` to skip that rejection. `exact` ignores case and end punctuation.

Replies are graded, not answer files, and a reply often says more than the answer.
Give `integer` and `number` checks `aliases` naming what the value measures: a reply
with a single number is compared directly, and a reply with several must put the
expected value nearest one of those names, in a sentence that names it. That is what
turns "I paged through 117 rows; the project has 118 traces" into a failure while
"3,579 spans across 117 traces" still passes.

`labeled_number` and `entity_count` tie a value to the label or entity it belongs to in
the same way. Use them whenever an answer states more than one number, because a plain
`number` or `integer` check would accept "Short: 14.6%; Long: 0.8%" or
"FinderTool had 20 calls; SearchTool had 24".

Keep a `source` field in `expected.json` that explains how the reference value was
derived, plus `accept` and `reject` lists of example answers. The unit tests grade
every example, so they document the check and catch regressions when the grader
changes. Cover a paraphrase, a wrong value, a hedge, a long reply that states the value
beside other numbers, a reply that mentions the value while answering something else,
and, for multi-number answers, a reversed or mislabelled version.

For a task that changes Phoenix state, write your own `test.sh`. The verifier venv has
`phoenix.client`, so query Phoenix at `http://127.0.0.1:6006`, decide the reward, and
call `evals.harbor.lib.grade.write_reward(reward, **extra)` to attach the ATIF
measurements. The plugin records each extra numeric key as a separate evaluation.

Then run `make harbor-bench-oracle TASKS=<name>`. The oracle runs `solution/solve.sh`
and the verifier with no model calls. Its answer provides the reference for
`expected.json`. A reward of `1` confirms that the verifier accepts the reference; it
does not show that incorrect answers fail.

### Adding a condition

A condition is an agent entry in `experiments/dev.yaml` (and `test.yaml`). Copy one,
change the agent class, model, MCP servers, `env`, or `skills`, and give it a new name.
To compare `px` releases, stage with another `PX_VERSION` and run under a `NAME` that
says so; to compare server versions, stage from the other checkout. Both change the
image, not the dataset, so the experiments land side by side on the same dataset
version.

Skills go in the agent's `skills` list as directories that contain `SKILL.md`. Harbor
installs them for Claude Code and Codex and records their digests in the job lock.

### Dev and test splits

`tasks/dev` is for iterating on tools, prompts, and skills. `tasks/test` is held out
for reporting. Put paraphrases of one question in the same split, and do not tune
against test. Each split is its own Phoenix dataset, so experiments are only ever
compared within a split.

### Tests

Unit tests for the grading library and the task layout run from the repository root:

```sh
uv run pytest tests/unit/harbor
```

The oracle run is the integration test for tasks, verifiers, and the environment.

## PXI tasks

### Run

Install the Phoenix client with its Harbor integration on Python 3.12 or newer:

```bash
pip install "arize-phoenix-client[harbor]"
```

Build Phoenix and stage each task's build context (from the repository root): the wheel,
the container assets, and the task's fixture database, which is baked into the image from
`gs://arize-phoenix-assets/evals/harbor/<task>/phoenix.db`. The same command packs the px
CLI and its workspace dependencies from source into `dist/phoenix-cli/`, outside every
build context, so the `claude-code-cli` agent tests the checkout's CLI without exposing it
to the other agents.

```bash
make harbor-stage-environments
```

Each task keeps its grading material under `tests/`, which Harbor uploads only when the
verifier runs, so the agent never sees the ground truth or the checks.

Run one agent on the task:

```bash
make harbor-run                                # PXI through the chat route
make harbor-run HARBOR_AGENT=claude-code-mcp   # Claude Code + the Phoenix MCP server
make harbor-run HARBOR_AGENT=claude-code-cli   # Claude Code + the px CLI and public skills
```

Run all three on the error-analysis task in one Daytona job, one trial per agent:

```bash
make harbor-compare
```

### Agents

Three agents run against the same environment and verifiers, so reward differences are
attributable to the surface:

| Agent | Surface | How it reaches Phoenix |
| --- | --- | --- |
| `phoenix-chat-agent` | PXI inside the Phoenix server | The agent session chat route; sidecars live in the PXI virtual shell |
| `claude-code-mcp` | Claude Code | The remote MCP server at `/mcp`, which also serves the error-analysis skill |
| `claude-code-cli` | Claude Code | `@arizeai/phoenix-cli` installed from the `dist/phoenix-cli/` tarballs with `PHOENIX_ENDPOINT` set, plus the four public skills from `.agents/skills/` passed with `--skill` |

The Claude Code agents are subclasses of Harbor's installed `claude-code` agent in
`evals/harbor/agents/claude_code_agents.py`. They run with Harbor's default
`bypassPermissions`, matching the chat agent's auto-approved tool calls, and with
`--resume-trajectory` so step 2 continues step 1's conversation. Claude Code only speaks
the Anthropic API, so pass an `anthropic/` model.

Every agent hands its work to the verifier through Harbor's own ATIF trajectory at
`/logs/agent/trajectory.json`, which Harbor writes for Claude Code after each step and which
`phoenix-chat-agent` builds from the turn's transcript in `populate_context_post_run`. The
verifier takes the final reply from the last agent step, counts tool calls from the steps, and
finds the PXI agent session through the trajectory's `session_id`. Sidecars are read from
`/app/.px/coding` on disk when present and from the PXI snapshot otherwise.

The `claude-code-cli` agent uploads the packed tarballs into its own sandbox during install
and runs `evals/harbor/agents/install_phoenix_cli.sh`, which turns each tarball into an npm
override so the workspace packages resolve to the local builds.

Test the Harbor plugin against a local Phoenix server with the direct task path used by
the PXI workflow:

```bash
make dev-backend
# In another terminal:
uv build --wheel packages/phoenix-client
CLIENT_WHEEL=$(ls dist/arize_phoenix_client-*.whl)
PYTHONPATH=. uvx --python 3.13 --from 'harbor[daytona]==0.21.0' --with "$CLIENT_WHEEL" \
  harbor run -p evals/harbor/tasks/error-analysis \
  -a evals.harbor.agents.phoenix_chat_agent:PhoenixChatAgent -m openai/gpt-6-astra -e docker \
  --plugin arize-phoenix \
  --plugin-kwarg endpoint=http://127.0.0.1:6006 \
  --plugin-kwarg trace_mode=null \
  --yes
```

A single direct task uses `harbor-task/<declared task name>` as its Phoenix dataset.
For several direct tasks, pass `--plugin-kwarg dataset=<name>` to name the synthetic
dataset explicitly.

### Experiment names

When a Harbor job has one agent configuration, give its Phoenix experiment an exact name with:

```bash
--plugin-kwarg experiment_name=my-baseline
```

An exact name is literal, so braces have no formatting behavior. Jobs with several agent
configurations create one Phoenix experiment per configuration and must use a template instead:

```bash
--plugin-kwarg 'experiment_name_template={job.name} · {agent.name} · {agent.model}'
```

The available template fields are:

| Field | Value |
| --- | --- |
| `{job.name}` | Harbor job name, falling back to the job ID |
| `{job.id}` | Unique Harbor job ID |
| `{dataset.name}` | Phoenix dataset name |
| `{agent.name}` | Harbor agent name |
| `{agent.model}` | Configured model name, or `default` |
| `{agent.short_digest}` | First twelve characters of the agent configuration digest |

Python callers can inspect the same field catalog through
`phoenix.client.harbor.EXPERIMENT_NAME_TEMPLATE_FIELDS`. Standard format specifications work for
the string-valued fields.

The plugin identifies an experiment by its Harbor job ID, Phoenix dataset version, and agent
configuration digest, not by its display name. Two jobs may use the same exact name without being
treated as the same experiment. Include `{job.name}` or `{job.id}` when those jobs should also be
easy to distinguish by name in Phoenix.

`make harbor-compare` takes plugin flags through `HARBOR_ARGS`:

```bash
make harbor-compare HARBOR_ARGS='--plugin arize-phoenix --plugin-kwarg endpoint=http://127.0.0.1:6006 \
  --plugin-kwarg "experiment_name_template={job.name} · {agent.name}"'
```

The trial targets accept overrides, e.g.:

```bash
make harbor-run HARBOR_TASK=evals/harbor/tasks/error-analysis \
  HARBOR_MODEL=anthropic/claude-sonnet-4-5 \
  HARBOR_ENV=docker \
  HARBOR_ATTEMPTS=1
```

Browse job results in a local web viewer:

```bash
make harbor-view
```

Optionally export traces to a remote Phoenix instance:

```bash
export HARBOR_PHOENIX_COLLECTOR_ENDPOINT=https://your-phoenix.example.com
export HARBOR_PHOENIX_API_KEY=...
export HARBOR_PHOENIX_PROJECT_NAME=harbor-server-agent-evals
```

The task runs under Harbor's allowlist network policy, so grant the collector's host for
the trial or the export is silently dropped: `HARBOR_ARGS='--allow-environment-host <host>'`
for `harbor-compare`, or the same flag on a direct `harbor run`.

### Network allowlists

The task allows nothing by itself; every host is granted at the narrowest level that
needs it, so `task.toml` (and with it the Phoenix dataset version) never changes for a
new provider or operator.

| Level | Set in | Applies to | Used for |
| --- | --- | --- | --- |
| Task baseline | `[environment]` in `task.toml` | the whole trial | nothing: `network_mode = "allowlist"` with no hosts |
| Verifier phase | `[verifier]` in `task.toml` | verification only | the LLM judge's provider |
| Job environment | `environment.extra_allowed_hosts` in the job file, or `--allow-environment-host` | the whole trial, every agent | the Phoenix docs hosts; the results Phoenix host when exporting |
| Agent | `extra_allowed_hosts` on an agent entry, or `--allow-agent-host` | that agent's run only | the agent's LLM provider |

`make harbor-run` derives the provider host from `HARBOR_MODEL` and grants the docs hosts
(`HARBOR_DOCS_HOSTS`, empty to run sealed); `make harbor-compare` reads the same from
`jobs/error-analysis.yaml`. Agent-level hosts are not in effect during agent install, so
anything an agent installs at that point must already be in the image or in the upload.

### Fixtures

The error-analysis fixture is hand-prepared. To replace it, upload the new database and
restage:

```bash
gcloud storage cp --cache-control=no-store phoenix.db \
  gs://arize-phoenix-assets/evals/harbor/error-analysis/phoenix.db
make harbor-stage-environments
```
