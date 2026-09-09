# Evals

The benchmark code lives under `evals/`; [evals/README.md](../evals/README.md) is the runbook. In short:

- `evals/harbor/`: the Harbor agent (`MouseAgent`, a subclass of Harbor's OpenCode adapter) plus model-route normalisation and trace parsing. Terminal-Bench tasks run through it.
- `evals/pier/`: the same agent on Pier's base classes, for DeepSWE tasks with `allow_internet = false`.
- `evals/fh/`: the import shim `evals.fh:MouseAgent` that resolves to whichever runner is importing it.
- `evals/frontierharness/`: the Runta runbook (`run-runta.sh`), `fill_trials.py`, and the task lists.
- `evals/report.py`: summarise a Harbor job directory.
- `install-mouse.sh` at the repository root: the FrontierHarness `--install-script`.

Both adapters upload `packages/cli/dist/mouse.mjs` (built with `pnpm bundle`) into the task container and run `mouse run --profile bench --yolo --format json`. The bench profile is frozen; changing a byte of it changes the benchmark.

## The numbers, and the rules for using them

Two full runs exist.

| Run | Result | How it was run |
|---|---|---|
| [`2026-09-08-mouse-c`](../evals/runs/2026-09-08-mouse-c/) | 25/30 (83.3%), datacurve 8/9, terminal-bench 17/21, $2.79 per pass | FrontierHarness's own `run-trials.sh` at eval commit e837a70, unmodified, on the golden checkpoint `fh-golden-mouse-v3` with a fresh restore per task. Kimi K3 direct from Fireworks, OpenCode 1.18.27, Pier for DeepSWE, harness commit `315e2b8`. All 30 trials valid. Submitted for reproduction as [frontier-harness-eval/eval#12](https://github.com/frontier-harness-eval/eval/issues/12). |
| [`2026-09-03-k3-openrouter`](../evals/runs/2026-09-03-k3-openrouter/) | 24/30 (80.0%), 18/21 Terminal-Bench, 6/9 DeepSWE | An earlier self-run on a cloud VM through Harbor for both suites, Kimi K3 via OpenRouter pinned to Fireworks, OpenCode 1.18.27, before the harness was extracted into this repository. |

The leaderboard's top published entry is Codex at 66.7% (20/30); stock OpenCode is 50.0% (15/30) on OpenCode 1.18.19. Those are FrontierHarness's numbers. Mouse is not on that board: FrontierHarness adds a harness after reproducing the result in their own environment, and until they do, quote the 25/30 as a submitted run, not a ranking.

Rules for anything measured here:

- A subset run is never compared to the leaderboard.
- Infrastructure failures are `infra_invalid`, never `failure`; a harness crash stays a `failure`.
- A number is always tied to an engine version, a model route, and a harness commit. The compat manifest records the version each result came from.
- Results ship as run directories (`trial.json` per task, `manifest.json`, `REPORT.md`, `chart.svg`, `SUBMISSION.md` or `provenance.json`) under `evals/runs/<run-id>/`. Those directories are never edited after they land.
- Two runs at different routes are not a variance estimate. A rerun a task or two either side of 25 would be unremarkable.
