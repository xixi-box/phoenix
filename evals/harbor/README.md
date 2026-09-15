# Harbor evaluations for Phoenix

Harbor tasks and tooling for evaluating agents against Phoenix. Harbor runs the agents
and the verifiers. The `arize-phoenix` Harbor plugin writes the results to a Phoenix of
your choice as versioned datasets, experiments, scores, and ATIF traces.

This directory contains two evaluation suites. The Phoenix tool benchmark compares
coding agents that reach Phoenix through the MCP server or the `px` CLI. The
`tasks/regression-triage` suite is the original multi-step Harbor task for Phoenix's
in-app agent.

## Phoenix tool benchmark

A trial starts two containers. One is a fresh Phoenix already seeded with the
[PatronusAI/TRAIL](https://huggingface.co/datasets/PatronusAI/TRAIL) traces and
annotations. The other holds Claude Code, Codex, and `px`. The agent answers a
question or changes Phoenix state, and the task's verifier grades the result while
that Phoenix is still up. The plugin then records the trial in whichever Phoenix you
point it at.

```text
conditions/           One Harbor job file per condition (agent x interface x versions)
environment/          Dockerfiles, the shared compose file, and the seed script
lib/                  Grading helpers used by task verifiers (pure Python, unit-tested)
scripts/              TRAIL download and image build
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
  TRAIL's terms forbid resharing it outside the Hugging Face hub. The download stays in
  a local cache, and a seeded image must never be pushed to a registry.
- A running Phoenix to receive results. The plugin reads `PHOENIX_COLLECTOR_ENDPOINT`
  and `PHOENIX_API_KEY` and defaults to `http://localhost:6006`.
- `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` for the coding-agent conditions.

### First time

```sh
HF_TOKEN=... make harbor-seed     # download TRAIL rows to evals/harbor/.cache
make harbor-images                # build the Phoenix image and the two agent images, tagged :local
make harbor-bench-oracle          # run every reference solution through the verifiers
```

`make harbor-images` builds the Phoenix image from this checkout, uncommitted changes
included, and seeds it during the build. A throwaway server starts inside a Dockerfile
stage, the repository's TRAIL loader pushes the rows through the public client, the
build waits until the API reports every trace and its computed cost, and the database
ships in the image. Rebuild that image whenever the server changes.

Rebuild the agent images with `make harbor-images IMAGES=agent` whenever `lib/` or the
pinned tool versions change. It takes seconds. Forgetting it is the most likely way to
get a confusing verifier error, because the verifier imports `lib/` from the image, not
from your checkout.

### Every run

```sh
make harbor-bench CONDITION=claude-mcp                      # whole dev split, one attempt
make harbor-bench CONDITION=codex-cli TASKS="count-traces total-cost" REPS=3
make harbor-bench CONDITION=claude-cli SPLIT=test NAME=cli-1.18.2-candidate
```

| Variable | Meaning | Default |
| --- | --- | --- |
| `CONDITION` | file under `conditions/` without `.yaml` | `claude-mcp` |
| `SPLIT` | task directory under `tasks/`; also names the Phoenix dataset `phoenix-tools-<split>` | `dev` |
| `TASKS` | space-separated task names to include | all in the split |
| `REPS` | attempts per task | `1` |
| `NAME` | Phoenix experiment name and Harbor job name; a new name starts a new experiment | `<condition>-<timestamp>` |

Each invocation is one Harbor job and one Phoenix experiment. To run several
conditions, invoke the target several times. The target prints the underlying
`harbor run` command, so you can also call `evals/harbor/.venv/bin/harbor` directly
with any other Harbor flags.

### What lands in Phoenix

- One dataset per split, versioned by the selected task content. Runs share a dataset
  version only when they use the same `SPLIT` and `TASKS` selection.
- One experiment per run, named by `NAME`.
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

### Inside a trial

`environment/docker-compose.yaml` adds a `phoenix` service beside Harbor's `main`
service. Every task sets Harbor's allowlist network policy with only the LLM provider
hosts allowed, so an agent cannot fetch documentation or read GitHub during a trial.
Harbor enforces the policy by putting every service in one network namespace. That is
why the agent reaches Phoenix at `http://127.0.0.1:6006` and the MCP server at
`http://127.0.0.1:6006/mcp` rather than by service name, and why `PHOENIX_ENDPOINT`
points `px` at localhost. The condition files disable web search and fetch tools. If a
Docker runtime cannot run the allowlist, Harbor rejects the trial before it starts.

There are two agent images. `phoenix-bench-agent` has no `px` at all, so MCP
conditions cannot fall back to the CLI. `phoenix-bench-agent-cli` adds `px` under
`/opt/px` and on `PATH`; CLI conditions and the oracle select it through the
`conditions/images/cli.yaml` compose overlay. Setting `PATH` through the agent's `env`
does not reach Codex's shells, so the image supplies the executable instead. An MCP
agent can still call Phoenix over plain HTTP on the same port as the MCP server; the
reward checks only the answer, not the interface used. The verifier venv lives under
`/opt/verifier` in both images and is off `PATH`.

Verification runs in Harbor's shared mode. After the agent finishes, Harbor copies the
task's `tests/` to `/tests` in the agent container and runs `test.sh` there with Phoenix
still up. A verifier can read `/workspace/answer.txt`, query Phoenix over HTTP, or
both. The alternative, an offline verifier container, would lose access to the Phoenix
the agent just changed, which is the whole point for state-changing tasks.

### Adding a task

```text
tasks/dev/<name>/
  instruction.md                 the prompt; end with the answer-file sentence for answer tasks
  task.toml                      copy from an existing task (network policy, image, timeouts)
  environment/docker-compose.yaml -> ../../../../environment/docker-compose.yaml (symlink)
  tests/test.sh                  the verifier entry point
  tests/expected.json            the reference, for answer tasks
  solution/solve.sh              a reference solution through px, run by the oracle
```

Reference solutions in Python import `evals.harbor.lib.phoenix_query` from
`/opt/verifier`, which fetches a project's spans through px. `task.toml`,
`tests/test.sh`, and the compose symlink are identical across tasks; a unit test checks
that they stay that way.

For a question with a checkable answer, `test.sh` calls the shared grader and
`expected.json` defines the comparison. These are the supported forms:

```json
{"kind": "integer", "value": 117}
{"kind": "number", "value": 16.0022, "places": 2}
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

`labeled_number` and `entity_count` tie a value to the label or entity it belongs to:
within each sentence that names the label, the nearest candidate number must be the
expected one. Use them whenever an answer states more than one number, because a plain
`number` or `integer` check would accept "Short: 14.6%; Long: 0.8%" or
"FinderTool had 20 calls; SearchTool had 24".

Keep a `source` field in `expected.json` that explains how the reference value was
derived, plus `accept` and `reject` lists of example answers. The unit tests grade
every example, so they document the check and catch regressions when the grader
changes. Cover a paraphrase, a wrong value, a hedge, and, for multi-number answers, a
reversed or mislabelled version.

For a task that changes Phoenix state, write your own `test.sh`. The verifier venv has
`phoenix.client`, so query Phoenix at `http://127.0.0.1:6006`, decide the reward, and
call `evals.harbor.lib.grade.write_reward(reward, **extra)` to attach the ATIF
measurements. The plugin records each extra numeric key as a separate evaluation.

Then run `make harbor-bench-oracle TASKS=<name>`. The oracle runs `solution/solve.sh`
and the verifier with no model calls. Its answer provides the reference for
`expected.json`. A reward of `1` confirms that the verifier accepts the reference; it
does not show that incorrect answers fail.

### Adding a condition

A condition is a Harbor job file. Copy one from `conditions/`, change the agent,
model, MCP servers, `env`, or `skills`, and commit it. To compare server or CLI
versions, build a second image pair with `make harbor-images TAG=candidate` from the
candidate checkout, then point a condition at those images with a compose overlay:

```yaml
environment:
  extra_docker_compose:
    - evals/harbor/conditions/images/candidate.yaml
```

```yaml
# conditions/images/candidate.yaml
services:
  main: { image: phoenix-bench-agent-cli:candidate }   # or phoenix-bench-agent for an MCP condition
  phoenix: { image: phoenix-bench-phoenix:candidate }
```

A condition can list several overlays. Later files win, so a CLI condition that
compares versions lists `images/cli.yaml` first and its candidate overlay second.

Skills go in the agent's `skills` list as directories that contain `SKILL.md`. Harbor
installs them for both agents and records their digests in the job lock.

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

## Phoenix headless agent task (regression-triage)

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

## Agents

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

## Network allowlists

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

## Fixtures

The error-analysis fixture is hand-prepared. To replace it, upload the new database and
restage:

```bash
gcloud storage cp --cache-control=no-store phoenix.db \
  gs://arize-phoenix-assets/evals/harbor/error-analysis/phoenix.db
make harbor-stage-environments
```
