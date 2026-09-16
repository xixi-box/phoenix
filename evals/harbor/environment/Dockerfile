# The one image every benchmark trial runs in: Phoenix, the coding agents, px, and the
# verifier, over a pre-seeded database. scripts/stage.sh copies this directory into each
# task's environment/ together with the staged inputs it lists (wheels/, data/, lib/,
# container_assets/, px-version); Harbor builds the image from there on Docker or Daytona.
# Nothing here reaches the network at trial time: Phoenix serves /data/phoenix.db, and the
# task's healthcheck starts it through /opt/phoenix-eval/start_phoenix_server.sh.
FROM python:3.13-slim-bookworm

# Node 22 for the coding agents and px. Copied from the official image because Debian
# bookworm ships Node 18.
COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:22-bookworm-slim /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
  && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
  && apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git jq procps ripgrep \
  && rm -rf /var/lib/apt/lists/*

# Both coding agents are preinstalled so Harbor does not install them during a trial,
# which would need registry access the allowlist does not grant.
ARG CLAUDE_CODE_VERSION=2.1.267
ARG CODEX_VERSION=0.154.0
RUN npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" "@openai/codex@${CODEX_VERSION}"

# px at the version stage.sh wrote to px-version, installed off the PATH. Only the px
# executable is exposed under /opt/px/bin; CLI conditions add that directory to their
# PATH in the job file, MCP conditions never see it, and pxi stays unreachable for all.
COPY px-version /opt/px-version
RUN npm install -g --prefix /opt/phoenix-cli "@arizeai/phoenix-cli@$(cat /opt/px-version)" \
  && mkdir -p /opt/px/bin \
  && ln -s /opt/phoenix-cli/bin/px /opt/px/bin/px

# Phoenix from this checkout.
COPY wheels/ /wheels/
RUN pip install --no-cache-dir /wheels/*.whl

# The verifier and the reference solutions import evals.harbor.lib from /opt/verifier,
# off the PATH, with a pinned client that does not depend on the Phoenix under test.
ARG PHOENIX_CLIENT_VERSION=3.5.0
RUN python -m venv /opt/verifier \
  && /opt/verifier/bin/pip install --no-cache-dir "arize-phoenix-client==${PHOENIX_CLIENT_VERSION}"
COPY lib/ /opt/verifier/

COPY container_assets/ /opt/phoenix-eval/
COPY data/ /data/
RUN mkdir -p /workspace
WORKDIR /workspace
