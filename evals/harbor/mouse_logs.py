"""Parse one trial's Mouse harness logs. No Harbor dependency."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def mouse_summary(logs_dir: Path) -> dict[str, Any] | None:
    """Token-weighted cache hit and completion-loop outcome for one trial."""
    steps = 0
    tokens = {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0, "cost": 0.0}
    opencode_log = logs_dir / "opencode.txt"
    if opencode_log.exists():
        for line in opencode_log.read_text(errors="replace").splitlines():
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            if ev.get("type") != "step_finish":
                continue
            steps += 1
            part = ev.get("part") or {}
            t = part.get("tokens") or {}
            cache = t.get("cache") or {}
            tokens["input"] += t.get("input") or 0
            tokens["output"] += t.get("output") or 0
            tokens["cache_read"] += cache.get("read") or 0
            tokens["cache_write"] += cache.get("write") or 0
            tokens["cost"] += part.get("cost") or 0.0
    outcome: dict[str, Any] = {}
    harness_log = logs_dir / "mouse-harness.jsonl"
    if harness_log.exists():
        for line in harness_log.read_text(errors="replace").splitlines():
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            if rec.get("type") in ("mouse.done", "mouse.error"):
                outcome = rec
    if steps == 0 and not outcome:
        return None
    denominator = tokens["input"] + tokens["cache_read"]
    return {
        "steps": steps,
        "tokens": tokens,
        "cache_hit_weighted": (tokens["cache_read"] / denominator) if denominator else None,
        "outcome": outcome.get("outcome") or outcome.get("error"),
        "rounds": outcome.get("rounds"),
        "elapsed_ms": outcome.get("elapsedMs"),
    }


def harness_fatal(logs_dir: Path) -> str | None:
    """The harness's own verdict on whether it crashed.

    ``mouse-harness.jsonl`` ends with ``mouse.done`` when the completion loop
    finished (whatever the task outcome) and ``mouse.error`` when the harness
    itself died. OpenCode ``error`` events alone are not a crash: the loop
    relaunches the engine after a transient provider error and keeps going, so
    the runner must not throw a finished trial away because one turn errored.
    Returns the error message on a crash, ``"no mouse.done record"`` when the
    log never reached a verdict, and ``None`` when the harness completed.
    """
    harness_log = logs_dir / "mouse-harness.jsonl"
    if not harness_log.exists():
        return "no mouse-harness.jsonl written"
    last: dict[str, Any] | None = None
    for line in harness_log.read_text(errors="replace").splitlines():
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        if rec.get("type") in ("mouse.done", "mouse.error"):
            last = rec
    if last is None:
        return "no mouse.done record"
    if last.get("type") == "mouse.error":
        return str(last.get("error") or "harness error")
    return None
