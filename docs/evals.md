# Evals

The benchmark code lives under `evals/`; [evals/README.md](../evals/README.md) is the runbook. In short:

- `evals/harbor/`: the Harbor agent (`MouseAgent`, a subclass of Harbor's OpenCode adapter) plus model-route normalisation and trace parsing. Terminal-Bench tasks run through it.
- `evals/pier/`: the same agent on Pier's base classes, for DeepSWE tasks with `allow_internet = false`.
- `evals/fh/`: the import shim `evals.fh:MouseAgent` that resolves to whichever runner is importing it.
- `evals/frontierharness/`: the Runta runbook (`run-runta.sh`), `fill_trials.py`, and the task lists.
- `evals/report.py`: summarise a Harbor job directory.
- `install-mouse.sh` at the repository root: the FrontierHarness `--install-script`.

Both adapters upload `packages/cli/dist/mouse.mjs` (built with `pnpm bundle`) into the task container and run `mouse run --profile bench --yolo --format json`. The bench profile is frozen; changing a byte of it changes the benchmark.

## The number, and the rules for using it

Mouse scored 24/30 on FrontierHarness v1.0 (18/21 Terminal-Bench, 6/9 DeepSWE) with Kimi K3 via OpenRouter pinned to Fireworks, on OpenCode 1.18.27 (opencode-ai@latest that day), on 2026-09-03. n=1. DeepSWE ran through the Harbor path, not Pier. FrontierHarness's published numbers for the same model are Codex 20/30 and stock OpenCode 15/30, on OpenCode 1.18.19; they are cited as their numbers.

Before this project makes any comparative claim of its own:

- Three full 30-task runs at pinned versions, reported as mean and range. The 24/30 becomes "run 1 of 3".
- Comparisons only against a same-day stock OpenCode control at the same engine version and model route. If the compat check for 1.18.19 passes, the runs happen on 1.18.19; otherwise every OpenCode comparison carries the version caveat.
- A subset run is never compared to the leaderboard.
- Infrastructure failures are `infra_invalid`, never `failure`; a harness crash stays a `failure`.
- DeepSWE results are labelled "Harbor path" until the Pier adapter has been verified on a full sweep.
- Results ship as run directories (`trial.json` per task, `manifest.json`, `REPORT.md`, `chart.svg`, `provenance.json`) under `evals/runs/<run-id>/`. Those directories are never edited after they land.

A rerun landing at 21 or 22 would be within plausible variance at n=1. Say so when quoting the number.
