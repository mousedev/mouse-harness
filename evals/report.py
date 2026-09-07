#!/usr/bin/env python3
"""Summarize a Harbor job directory the way FrontierHarness reports.

    python3 evals/report.py <job-dir> [<job-dir> ...]

For every trial it finds ``opencode.txt`` (per-step tokens and cost) and
``mouse-harness.jsonl`` (completion-loop rounds and outcome), and reads the
trial's ``result.json`` when present for the verifier verdict. Prints pass
rate split Terminal-Bench / DeepSWE, median cost per task and per pass,
median steps, and the token-weighted cache hit rate. Best-effort: fields
Harbor does not write are shown as ``-``.
"""

from __future__ import annotations

import json
import statistics
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent / "harbor"))
from mouse_logs import mouse_summary  # noqa: E402


DEEPSWE_TASKS = {
    "anko-typed-variable-bindings",
    "arktype-json-schema-refs-dependencies",
    "fastapi-deprecation-response-headers",
    "httpx-multipart-response-parsing",
    "expr-try-catch-errors",
    "python-statemachine-state-data-scoping",
    "katex-multicolumn-array-spans",
    "scc-bounded-memory-spilling",
    "meriyah-explicit-resource-declarations",
}


def is_deepswe(trial_name: str) -> bool:
    """Harbor names trial dirs `<task>__<id>`, truncating long task names."""
    stem = trial_name.split("__")[0]
    return any(t.startswith(stem) or stem.startswith(t) for t in DEEPSWE_TASKS)


def load_result(trial: Path) -> bool | None:
    for name in ("result.json", "results.json"):
        f = trial / name
        if not f.exists():
            continue
        try:
            data = json.loads(f.read_text())
        except json.JSONDecodeError:
            return None
        return _reward(data)
    return None


def _reward(data: Any) -> bool | None:
    if isinstance(data, dict):
        for key in ("reward", "rewards", "score", "passed", "is_resolved"):
            if key in data:
                value = data[key]
                if isinstance(value, dict):
                    value = next(iter(value.values()), None)
                if isinstance(value, bool):
                    return value
                if isinstance(value, (int, float)):
                    return value >= 1
        for value in data.values():
            found = _reward(value)
            if found is not None:
                return found
    return None


def median(values: list[float]) -> str:
    return f"{statistics.median(values):.3f}" if values else "-"


def main(dirs: list[str]) -> int:
    rows: list[dict[str, Any]] = []
    for d in dirs:
        root = Path(d)
        for log in root.rglob("opencode.txt"):
            trial = log.parent
            while trial != root and not (trial / "result.json").exists() and trial.parent != root:
                trial = trial.parent
            summary = mouse_summary(log.parent) or {}
            name = trial.name
            rows.append(
                {
                    "task": name,
                    "deepswe": "datacurve" in str(trial) or is_deepswe(name),
                    "pass": load_result(trial),
                    "cost": (summary.get("tokens") or {}).get("cost"),
                    "steps": summary.get("steps"),
                    "cache": summary.get("cache_hit_weighted"),
                    "outcome": summary.get("outcome"),
                    "rounds": summary.get("rounds"),
                    "elapsed_min": (summary.get("elapsed_ms") or 0) / 60000 or None,
                }
            )
    if not rows:
        print("no trials found")
        return 1

    rows.sort(key=lambda r: (r["deepswe"], r["task"]))
    print(f"{'task':44} {'set':7} {'pass':5} {'$':>7} {'steps':>5} {'cache':>6} {'min':>6}  outcome/rounds")
    for r in rows:
        print(
            f"{r['task'][:44]:44} {'DeepSWE' if r['deepswe'] else 'TB':7} "
            f"{'-' if r['pass'] is None else ('PASS' if r['pass'] else 'FAIL'):5} "
            f"{(f'{r['cost']:.3f}' if isinstance(r['cost'], (int, float)) else '-'):>7} "
            f"{(r['steps'] if r['steps'] is not None else '-'):>5} "
            f"{(f'{r['cache']*100:.0f}%' if isinstance(r['cache'], float) else '-'):>6} "
            f"{(f'{r['elapsed_min']:.1f}' if r['elapsed_min'] else '-'):>6}  "
            f"{r['outcome'] or '-'}/{r['rounds'] if r['rounds'] is not None else '-'}"
        )

    graded = [r for r in rows if r["pass"] is not None]
    passes = [r for r in graded if r["pass"]]
    tb = [r for r in graded if not r["deepswe"]]
    ds = [r for r in graded if r["deepswe"]]
    costs = [r["cost"] for r in rows if isinstance(r["cost"], (int, float))]
    pass_costs = [r["cost"] for r in passes if isinstance(r["cost"], (int, float))]
    total_cost = sum(costs) if costs else 0.0
    print()
    print(f"pass rate: {len(passes)}/{len(graded)}" + (f" ({len(passes)/len(graded)*100:.1f}%)" if graded else ""))
    print(f"  TB {sum(1 for r in tb if r['pass'])}/{len(tb)}   DeepSWE {sum(1 for r in ds if r['pass'])}/{len(ds)}")
    print(f"total $ {total_cost:.2f}   $/pass {(total_cost/len(passes)) if passes else float('nan'):.2f}")
    print(f"median $/task {median(costs)}   median $/pass {median(pass_costs)}")
    print(f"median steps/pass {median([float(r['steps']) for r in passes if r['steps'] is not None])}")
    print(f"median cache/pass {median([r['cache'] for r in passes if isinstance(r['cache'], float)])}")
    print(f"median min/pass {median([r['elapsed_min'] for r in passes if r['elapsed_min']])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:] or ["."]))
