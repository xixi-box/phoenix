#!/bin/bash
# Stage the benchmark image inputs from this checkout, then copy the shared
# environment/ into every task so Harbor can build the same image from any of
# them, on Docker or Daytona.
#
#   wheels/            the Phoenix wheel built from this checkout
#   data/phoenix.db    the fixture database, seeded once from the TRAIL rows
#   lib/               evals.harbor.lib for the verifier and reference solutions
#   container_assets/  the Phoenix start script the task healthcheck runs
#   px-version         the @arizeai/phoenix-cli version the Dockerfile installs
#
# PX_VERSION picks the px release. RESEED=1 rebuilds the database even if one
# is staged. The TRAIL rows never leave .cache/, and the seeded database goes
# only into the task build contexts, never to a registry or a bucket.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
HERE="$ROOT/evals/harbor"
ENVIRONMENT="$HERE/environment"
ROWS="$HERE/.cache/trail-gaia.json"
SEED_BUILD="$HERE/.cache/seed"
PX_VERSION=${PX_VERSION:-1.18.2}
RESEED=${RESEED:-0}

if [ ! -f "$ROWS" ]; then
  echo "error: missing $ROWS; run 'make harbor-seed' first" >&2
  exit 1
fi

echo "Building the Phoenix wheel from $ROOT"
rm -rf "$ENVIRONMENT/wheels"
(cd "$ROOT" && uv build --wheel --out-dir "$ENVIRONMENT/wheels" >/dev/null)

if [ "$RESEED" = 1 ] || [ ! -f "$ENVIRONMENT/data/phoenix.db" ]; then
  echo "Seeding the fixture database from the TRAIL rows"
  rm -rf "$SEED_BUILD"
  mkdir -p "$SEED_BUILD/seed"
  cp -R "$ENVIRONMENT/wheels" "$SEED_BUILD/wheels"
  cp "$ROWS" "$ROOT/scripts/load_patronus_trail.py" "$HERE/scripts/seed.py" "$SEED_BUILD/seed/"
  docker build -q -f "$HERE/scripts/seed.Dockerfile" -t phoenix-bench-seed:local "$SEED_BUILD" >/dev/null
  container=$(docker create phoenix-bench-seed:local)
  rm -rf "$ENVIRONMENT/data"
  mkdir -p "$ENVIRONMENT/data"
  docker cp "$container:/data/phoenix.db" "$ENVIRONMENT/data/phoenix.db"
  docker cp "$container:/seed/summary.json" "$HERE/.cache/seed-summary.json"
  docker rm "$container" >/dev/null
  rm -rf "$SEED_BUILD"
  cat "$HERE/.cache/seed-summary.json"
else
  echo "Reusing the staged database at $ENVIRONMENT/data/phoenix.db (RESEED=1 to rebuild)"
fi

rm -rf "$ENVIRONMENT/lib" "$ENVIRONMENT/container_assets"
mkdir -p "$ENVIRONMENT/lib/evals/harbor"
cp "$ROOT/evals/__init__.py" "$ENVIRONMENT/lib/evals/"
cp "$HERE/__init__.py" "$ENVIRONMENT/lib/evals/harbor/"
rsync -a --exclude __pycache__ "$HERE/lib/" "$ENVIRONMENT/lib/evals/harbor/lib/"
rsync -a --exclude __pycache__ "$HERE/container_assets/" "$ENVIRONMENT/container_assets/"
printf '%s\n' "$PX_VERSION" > "$ENVIRONMENT/px-version"

staged=0
for task in "$HERE"/tasks/dev/*/ "$HERE"/tasks/test/*/; do
  [ -f "$task/task.toml" ] || continue
  # Hard links (--link-dest) keep ten copies of the database from costing ten times
  # the disk; Docker and Daytona read them as ordinary files.
  rsync -a --delete --link-dest="$ENVIRONMENT/" "$ENVIRONMENT/" "$task/environment/"
  staged=$((staged + 1))
done
echo "Staged environment/ (px $PX_VERSION) into $staged task(s)"
