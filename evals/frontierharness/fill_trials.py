#!/usr/bin/env python3
"""Fill FrontierHarness trial records from the runner's own results.

``run-trials.sh`` reads reward, cost, turns, and cache rate only from
top-level keys of JSON files under each trial's ``jobs/`` copy. Harbor and
Pier nest all of them in ``result.json`` (``verifier_result.rewards``,
``agent_result.cost_usd``), and Terminal-Bench verifiers write
``reward.txt`` rather than JSON, so without this step every Terminal-Bench
pass scores as a failure and every cost is null. This walks the runner's
``result.json`` and Mouse's per-trial metadata and writes the fields
``normalize-results.mjs`` consumes. Run it after the trials and before
normalizing:

    python3 evals/frontierharness/fill_trials.py runs/<run-id> [--dry-run]

Every value written is traceable: ``filled_from`` names the result file,
``cost_source`` says whether the cost came from the runner or from token
counts at Kimi K3 list price, and ``reward`` is the raw verifier value.
Trials already marked ``infra_invalid`` and trials whose runner exited on the
5400 s timeout are left as they are.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "harbor"))
from mouse_logs import mouse_summary  # noqa: E402

# USD per million tokens, Kimi K3 list price (frontier-harness-eval reference.md:
# Moonshot list, matched by Fireworks standard serverless, OpenRouter, Together).
LIST_PRICE = {"input": 3.00, "cache_read": 0.30, "output": 15.00}


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None


def runner_results(jobs_dir: Path) -> list[tuple[Path, dict[str, Any]]]:
    """Harbor/Pier trial results: result.json files carrying trial_name and task_name."""
    found = []
    for path in sorted(jobs_dir.rglob("result.json")):
        data = load_json(path)
        if isinstance(data, dict) and "trial_name" in data and "task_name" in data:
            found.append((path, data))
    return found


def pick(results: list[tuple[Path, dict[str, Any]]]) -> tuple[Path, dict[str, Any]] | None:
    """One result per trial: a verified one beats an unverified one, then the latest."""
    if not results:
        return None

    def key(item: tuple[Path, dict[str, Any]]) -> tuple[int, str]:
        _, data = item
        verified = 1 if reward_of(data) is not None else 0
        return (verified, str(data.get("finished_at") or ""))

    return max(results, key=key)


def reward_of(data: dict[str, Any]) -> float | None:
    rewards = (data.get("verifier_result") or {}).get("rewards")
    if not isinstance(rewards, dict) or not rewards:
        return None
    value = rewards.get("reward", next(iter(rewards.values())))
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def seconds_between(timing: dict[str, Any] | None) -> float | None:
    if not timing or not timing.get("started_at") or not timing.get("finished_at"):
        return None
    from datetime import datetime

    try:
        start = datetime.fromisoformat(str(timing["started_at"]))
        end = datetime.fromisoformat(str(timing["finished_at"]))
    except ValueError:
        return None
    return round((end - start).total_seconds(), 1)


def mouse_metadata(result_path: Path, data: dict[str, Any]) -> dict[str, Any] | None:
    meta = ((data.get("agent_result") or {}).get("metadata") or {}).get("mouse")
    if isinstance(meta, dict):
        return meta
    agent_logs = result_path.parent / "agent"
    return mouse_summary(agent_logs) if agent_logs.is_dir() else None


def fill(trial_path: Path) -> dict[str, Any] | None:
    trial = load_json(trial_path)
    if not isinstance(trial, dict):
        return None
    if trial.get("status") == "infra_invalid":
        return {"id": trial.get("id"), "note": "infra_invalid, left as is"}

    picked = pick(runner_results(trial_path.parent / "jobs"))
    if picked is None:
        return {"id": trial.get("id"), "note": "no runner result.json under jobs/, left as is"}
    result_path, data = picked

    reward = reward_of(data)
    agent = data.get("agent_result") or {}
    exception = data.get("exception_info") or None
    mouse = mouse_metadata(result_path, data) or {}
    tokens = mouse.get("tokens") or {}

    cost = agent.get("cost_usd")
    cost_source = "runner"
    if not isinstance(cost, (int, float)) or cost <= 0:
        cost = tokens.get("cost")
        cost_source = "opencode_step_cost"
    if not isinstance(cost, (int, float)) or cost <= 0:
        if any(tokens.get(k) for k in ("input", "output", "cache_read")):
            cost = (
                (tokens.get("input") or 0) * LIST_PRICE["input"]
                + (tokens.get("cache_read") or 0) * LIST_PRICE["cache_read"]
                + (tokens.get("output") or 0) * LIST_PRICE["output"]
            ) / 1_000_000
            cost_source = "tokens_at_list_price"
        else:
            cost, cost_source = None, "unavailable"

    cache = mouse.get("cache_hit_weighted")
    if cache is None and agent.get("n_input_tokens"):
        # Harbor's n_input_tokens is total input including cache reads.
        cache = (agent.get("n_cache_tokens") or 0) / agent["n_input_tokens"]

    turns = mouse.get("steps")
    if turns is None:
        trajectory = load_json(result_path.parent / "agent" / "trajectory.json")
        if isinstance(trajectory, dict):
            turns = (trajectory.get("final_metrics") or {}).get("total_steps")

    if trial.get("status") == "timeout" or trial.get("exit_code") == 124:
        status, success = "timeout", False
    elif reward is None:
        # Verifier never ran (harness crash, or the runner errored out).
        status, success = "failure", False
    else:
        success = reward >= 1
        status = "success" if success else "failure"

    # Harbor and Pier retry agent-level exceptions (their template passes -r), so a
    # scored trial may be the second or third attempt. Record it.
    attempts = 1
    job_log = result_path.parent.parent / "job.log"
    if job_log.exists():
        attempts += sum(1 for line in job_log.read_text(errors="replace").splitlines() if "Retrying in" in line)

    updated = {
        **trial,
        "attempts": attempts,
        "status": status,
        "success": success,
        "reward": reward,
        "cost_first_cold_usd": round(cost, 6) if isinstance(cost, (int, float)) else None,
        "cost_source": cost_source,
        "turns": int(turns) if isinstance(turns, (int, float)) else trial.get("turns"),
        "cache_hit_rate_normalized": round(cache, 4) if isinstance(cache, (int, float)) else None,
        "tokens": tokens or None,
        "agent_execution_seconds": seconds_between(data.get("agent_execution")),
        "harness_outcome": mouse.get("outcome"),
        "harness_exception": (
            f"{exception.get('exception_type')}: {exception.get('exception_message')}"
            if isinstance(exception, dict) else trial.get("harness_exception")
        ),
        "included_in_efficiency": success,
        "filled_from": str(result_path.relative_to(trial_path.parent)),
    }
    return updated


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("run_dir", type=Path, help="runs/<run-id> produced by run-trials.sh")
    parser.add_argument("--dry-run", action="store_true", help="print what would change, write nothing")
    args = parser.parse_args()

    trials_dir = args.run_dir / "trials"
    if not trials_dir.is_dir():
        print(f"no trials directory at {trials_dir}", file=sys.stderr)
        return 1

    rows = []
    for trial_path in sorted(trials_dir.glob("*/trial.json")):
        updated = fill(trial_path)
        if updated is None:
            rows.append((trial_path.parent.name, "unreadable trial.json", "", "", "", ""))
            continue
        if "note" in updated:
            rows.append((updated["id"], updated["note"], "", "", "", ""))
            continue
        if not args.dry_run:
            trial_path.write_text(json.dumps(updated, indent=2) + "\n")
        rows.append((
            updated["id"], updated["status"],
            "" if updated["reward"] is None else f"{updated['reward']:g}",
            "" if updated["cost_first_cold_usd"] is None else f"${updated['cost_first_cold_usd']:.2f} ({updated['cost_source']})",
            "" if updated["turns"] is None else str(updated["turns"]),
            "" if updated["cache_hit_rate_normalized"] is None else f"{updated['cache_hit_rate_normalized'] * 100:.0f}%",
        ))

    width = max((len(r[0]) for r in rows), default=10)
    print(f"{'task':<{width}}  {'status':<8}  {'reward':<6}  {'cost':<28}  {'turns':<5}  cache")
    for row in rows:
        print(f"{row[0]:<{width}}  {row[1]:<8}  {row[2]:<6}  {row[3]:<28}  {row[4]:<5}  {row[5]}")
    passed = sum(1 for r in rows if r[1] == "success")
    scored = sum(1 for r in rows if r[1] in ("success", "failure", "timeout"))
    print(f"\n{passed}/{scored} passed{' (dry run, nothing written)' if args.dry_run else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
