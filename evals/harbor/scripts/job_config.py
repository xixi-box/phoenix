"""Write a Harbor job file that keeps only the selected agents and tasks of an experiment.

Harbor's ``-a`` flag replaces a job file's agents with a bare agent entry, which
drops the MCP servers, environment, and skills that make a benchmark condition,
and ``--include-task-name`` only works with ``--path``. Selecting by name here
keeps the full entries and filters the file's datasets by ``task_names``.

Usage::

    python evals/harbor/scripts/job_config.py experiments/dev.yaml --out job.yaml \
        --agents claude-mcp oracle --tasks count-traces
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

import yaml


def select_agents(config: dict[str, Any], names: list[str]) -> dict[str, Any]:
    agents = {agent["name"]: agent for agent in config.get("agents", [])}
    unknown = [name for name in names if name not in agents]
    if unknown:
        raise SystemExit(f"unknown agents {unknown}; the file defines {sorted(agents)}")
    return {**config, "agents": [agents[name] for name in names]} if names else config


def select_tasks(config: dict[str, Any], names: list[str]) -> dict[str, Any]:
    if not names:
        return config
    datasets = [{**dataset, "task_names": list(names)} for dataset in config.get("datasets", [])]
    return {**config, "datasets": datasets}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("experiment", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument(
        "--agents", nargs="*", default=[], help="agent names to keep; all when empty"
    )
    parser.add_argument("--tasks", nargs="*", default=[], help="task names to keep; all when empty")
    args = parser.parse_args()
    config = yaml.safe_load(args.experiment.read_text())
    selected = select_tasks(select_agents(config, args.agents), args.tasks)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(yaml.safe_dump(selected, sort_keys=False))
    agents = ", ".join(agent["name"] for agent in selected["agents"])
    tasks = ", ".join(args.tasks) or "every task"
    print(f"{agents} on {tasks}", file=sys.stderr)


if __name__ == "__main__":
    main()
