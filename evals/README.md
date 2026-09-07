# Mouse harness evals

Runs the Mouse harness on [FrontierHarness](https://frontierharness.org) tasks (Terminal-Bench plus DeepSWE) through the runners the benchmark itself uses: [Harbor](https://www.harborframework.com/) for Terminal-Bench and Pier (datacurve-pier, a Harbor fork) for DeepSWE. The agent is Harbor's own OpenCode adapter with Mouse's bundled CLI (`packages/cli/dist/mouse.mjs`) driving `opencode run`. Same engine, same transport as the stock OpenCode control; only Mouse's config, agent prompt, and completion loop differ.

The claim rules for anything measured here are in [docs/evals.md](../docs/evals.md). Read them before quoting a number.

## Layout

| Path | What |
|---|---|
| `harbor/mouse_agent.py` | `MouseAgent(OpenCode)` for Harbor 0.22: uploads the bundle, runs `mouse run --profile bench --yolo --format json`, reports `mouse/<ver> opencode/<ver>` as the agent version, attaches Mouse's trace summary to the trial metadata. |
| `harbor/model_route.py` | Normalises the LiteLLM routes FrontierHarness passes (`fireworks_ai/...`) to OpenCode provider ids (`fireworks-ai/...`); pins `OPENCODE_VERSION = "1.14.22"`; provider hosts and key names. |
| `harbor/mouse_logs.py` | Parses one trial's `opencode.txt` and `mouse-harness.jsonl`: steps, tokens, token-weighted cache hit, outcome, and whether the harness crashed. No Harbor dependency. |
| `pier/mouse_agent.py` | The same agent on Pier 0.3.1's base classes, with the provider host added to the task's network allowlist so the model is reachable from an `allow_internet = false` container. |
| `fh/__init__.py` | The import shim `evals.fh:MouseAgent`: resolves to the Pier adapter inside Pier's environment and the Harbor adapter inside Harbor's. |
| `frontierharness/run-runta.sh` | Wraps FrontierHarness's own scripts for the Runta workflow: provision, smoke, trials, retry, score. |
| `frontierharness/fill_trials.py` | Fills `trial.json` records from Harbor's and Pier's `result.json` and Mouse's trace before FrontierHarness normalises. |
| `frontierharness/*.txt` | Task lists: `all-tasks.txt` (30), `terminal-bench-tasks.txt` (21), `deepswe-tasks.txt` (9), `smoke-tasks.txt` (one of each). |
| `report.py` | Summarises a Harbor job directory the way FrontierHarness reports. |
| `requirements.txt` | Runner versions: `harbor==0.22.0`, `datacurve-pier==0.3.1`. Install them as tools, not into a project venv. |
| `../install-mouse.sh` | The FrontierHarness `--install-script`, at the repository root. |

`tasks/`, `jobs/`, and `.env` are gitignored.

## One-time setup

```bash
uv tool install harbor==0.22.0
uv tool install datacurve-pier==0.3.1        # only needed for DeepSWE through Pier
pnpm install --frozen-lockfile --ignore-scripts
pnpm bundle                                  # -> packages/cli/dist/mouse.mjs
cp evals/.env.example evals/.env             # add FIREWORKS_API_KEY (a benchmark-only key)
set -a; source evals/.env; set +a            # before every run in this shell
```

Keys live in `evals/.env`, which is gitignored. The adapters pass `FIREWORKS_API_KEY` / `OPENROUTER_API_KEY` into the task container for the run only; they are never written to the image or the logs. Use a key created for benchmarking so its spend is visible on its own line.

Docker must be running. Task definitions come from the registry (`harbor tasks download`) or from a checkout of [frontier-harness-eval/eval](https://github.com/frontier-harness-eval/eval), where each `tasks/<task>/` has `task.toml` and the exact `instruction.md`.

## Run one task locally (Harbor)

Harbor 0.22 runs tasks from a local directory. Download each task once, then run from the repository root so the agent module imports:

```bash
harbor tasks download terminal-bench/regex-log -o evals/tasks
PYTHONPATH=. harbor run -p evals/tasks/regex-log \
  --agent evals.harbor.mouse_agent:MouseAgent \
  --model openrouter/moonshotai/kimi-k3 --jobs-dir evals/jobs -y
python3 evals/report.py evals/jobs
```

`--model fireworks-ai/accounts/fireworks/models/kimi-k3` with `FIREWORKS_API_KEY` is the benchmark's exact route. With an OpenRouter key the bench config pins OpenRouter's routing to Fireworks with fallbacks off, so the weights and the prefix cache match; the only difference is OpenRouter's fee.

DeepSWE tasks live under `datacurve/` in the registry and allow 5400 s; pass the longer wall clock:

```bash
harbor tasks download datacurve/python-statemachine-state-data-scoping -o evals/tasks
PYTHONPATH=. harbor run -p evals/tasks/python-statemachine-state-data-scoping \
  --agent evals.harbor.mouse_agent:MouseAgent \
  --model openrouter/moonshotai/kimi-k3 --ak max_wall_sec=4800 --jobs-dir evals/jobs -y
```

Several tasks at once: repeat `-p` per task directory and set `-n` for concurrency.

Agent options (`--ak key=value`): `max_wall_sec` (Harbor default 780, Pier default 4800), `max_steps` (600), `non_progress_rounds` (3), `version` (the OpenCode version installed in the container, default 1.14.22). `MOUSE_TOOL_OUTPUT_PRUNE=1` in the host environment turns on the per-result output cap plugin.

Control run with stock OpenCode at the pinned version:

```bash
harbor run -p evals/tasks/regex-log --agent opencode \
  --model openrouter/moonshotai/kimi-k3 --ak version=1.14.22 --jobs-dir evals/jobs -y
```

## Run one DeepSWE task through Pier

```bash
PYTHONPATH=. pier run -p evals/tasks/python-statemachine-state-data-scoping \
  --agent-import-path evals.pier.mouse_agent:MouseAgent \
  --model openrouter/moonshotai/kimi-k3 --jobs-dir evals/jobs -y
```

Pier 0.3.1 takes custom agents through `--agent-import-path` and `--jobs-dir`. The Pier adapter was written against Pier's source; verify on the runtime with `pier run --help` before a full sweep. Until a full sweep has run through Pier, DeepSWE results are labelled "Harbor path".

## Inside a trial

`/logs/agent/` in the container (copied into the job directory):

- `opencode.txt`: the raw `opencode run --format=json` event stream, which Harbor's trajectory parser reads.
- `mouse-harness.jsonl`: Mouse's trace ([docs/trace.md](../docs/trace.md)). It ends in `mouse.done` when the loop finished (whatever the task outcome) and `mouse.error` when the harness itself died. The adapters raise to the runner only in the second case, so a trial the loop finished is never retried away.
- `mouse-harness.stderr`: OpenCode's stderr and Mouse's warnings.

`python3 evals/report.py <job-dir>` prints per trial: verifier verdict, cost, steps, token-weighted cache hit, minutes, and the completion loop's outcome and round count; then pass rate split Terminal-Bench / DeepSWE, total spend over passes, median cost per task and per pass, median steps, cache hit, and time.

## On Runta, the way the leaderboard was run

FrontierHarness will consider adding a harness to the public leaderboard once it has been run in their controlled environment and they can reproduce the result. Their workflow ships in [frontier-harness-eval/eval](https://github.com/frontier-harness-eval/eval) under `skills/frontierharness-eval/`: one golden checkpoint on a Runta runtime, one fresh restore per task, their scoring and report. `frontierharness/run-runta.sh` wraps their scripts rather than replacing them, so the run stays the one their team can reproduce.

### What Mouse looks like to their scripts

| Their flag | Value |
| --- | --- |
| `--harness` | `evals.fh:MouseAgent` (Harbor takes it as `-a`; Pier as `--agent-import-path`) |
| `--install-script` | `install-mouse.sh` at the repository root (builds the bundle, registers the checkout on both runners' import paths) |
| `--repo` / `--commit` | `https://github.com/mousedev/mouse-harness` at a pinned commit |
| `--provider` | `fireworks` (the baselines' provider, so cost is comparable) |

`evals.fh` resolves to the Pier adapter inside Pier's environment and the Harbor adapter inside Harbor's. Both adapters normalise the LiteLLM route their scripts pass (`fireworks_ai/...`) to OpenCode's provider id (`fireworks-ai/...`), pin OpenCode to 1.14.22, and raise to the runner only when the harness itself crashed.

### Known gaps in their skill, and how this handles them

- **Pier flags.** Pier 0.3.1 has `--agent-import-path` and `--jobs-dir`; the skill's default DeepSWE template passes `--agent` and `--output-dir`, which Pier rejects. `run-runta.sh` runs DeepSWE tasks with a corrected `--cmd` under the same `--run-id`, so both suites land in one `runs/<run-id>/trials/` directory.
- **Terminal-Bench rewards.** Their `run-trials.sh` reads rewards from top-level keys of JSON files only. Terminal-Bench verifiers write `reward.txt`, and Harbor nests the reward in `result.json`, so every Terminal-Bench pass would score as a failure and cost would be null. `fill_trials.py` reads Harbor's and Pier's `result.json` and Mouse's per-trial metadata and fills `trial.json` before `normalize-results.mjs`. Every filled value records where it came from (`filled_from`, `cost_source`, raw `reward`). Trials already marked `infra_invalid` and trials that hit the 5400 s timeout are left alone.
- **DeepSWE ref.** `benchmark.json` says `datacurve-ai/deep-swe` v1.1, but that repository has no `v1.1` tag; `main` at `0b9fabbb` (2026-08-26) carries the v1.1 task images. `DEEP_SWE_REF` pins that commit. State it in the report.

### Steps

Needs: `runta` (`brew install runta-dev/tap/runta`) logged in, `jq`, Node, a checkout of frontier-harness-eval/eval, and this repository public at a pinned commit.

```bash
export FH_EVAL=~/src/frontier-harness-eval   # git clone https://github.com/frontier-harness-eval/eval
export REPO=https://github.com/mousedev/mouse-harness COMMIT=<sha>
runta secret set FIREWORKS_API_KEY --prompt  # once; a benchmark-only key

evals/frontierharness/run-runta.sh provision   # 30-60 min: clean runtime, clone, Harbor+Pier, pre-pull images, freeze
evals/frontierharness/run-runta.sh smoke       # regex-log + fastapi task; spot-check trial.json
evals/frontierharness/run-runta.sh trials      # all 30, sequential, one restore each (5-8 h)
evals/frontierharness/run-runta.sh score       # fill, normalize, chart, REPORT.md
```

Optional environment: `PROVIDER` (`fireworks` default, or `openrouter`, `moonshot`, `together`), `CHECKPOINT` (`fh-golden-mouse-v1`), `RUN_ID` (`<today>-mouse`), `DEEP_SWE_REF`, `OUT` (`runs`, relative to `FH_EVAL`).

If a trial dies on infrastructure, re-run it (`run-runta.sh retry file-with-ids`); if it dies again, mark it rather than scoring it:

```bash
trial=$FH_EVAL/runs/<run-id>/trials/terminal-bench-<task>/trial.json
jq '.status = "infra_invalid" | .success = false' "$trial" > "$trial.tmp" && mv "$trial.tmp" "$trial"
```

### Smoke-test checklist

After `smoke`, before spending the full budget:

- `trial.json` for `regex-log` shows `status: success` or `failure` with a numeric `reward` and a `cost_source` other than `unavailable`.
- `jobs/**/agent/mouse-harness.jsonl` exists and ends in `mouse.done`.
- `jobs/**/agent/opencode.txt` has `step_finish` events with non-zero tokens. If every turn is an auth error, the credential rule or egress allowlist is wrong.
- The DeepSWE trial's `verifier/reward.json` exists (the separate verifier ran).
- `manifest.json` in the trial shows the expected commit, `harbor 0.22.0`, `pier 0.3.1`, and an agent version of the form `mouse/0.1.0 opencode/1.14.22`.

### What to send FrontierHarness

Their ask: report, configuration, logs. From `$FH_EVAL/runs/<run-id>/`:

- `report/REPORT.md` and `report/chart.svg`
- `candidate.json` and `run.json`
- `trials/*/trial.json`, `trials/*/manifest.json`, and the `trials/*/jobs/` evidence (trajectories, `mouse-harness.jsonl`, verifier logs, `model.patch`)
- The repository URL and commit, this README, and the exact `run-runta.sh` invocations

Relaxations to state in the report: one shared golden checkpoint (their published cells used one per task), the DeepSWE ref pin above, `fill_trials.py` as the reward and cost source, and any trial marked `infra_invalid`.

### Local sanity checks (no Runta needed)

```bash
PYTHONPATH=. ~/.local/share/uv/tools/harbor/bin/python -c 'from evals.fh import MouseAgent; print(MouseAgent.__module__)'
PYTHONPATH=. ~/.local/share/uv/tools/datacurve-pier/bin/python -c 'from evals.fh import MouseAgent; print(MouseAgent.__module__)'
```

The first prints `evals.harbor.mouse_agent`, the second `evals.pier.mouse_agent`. `install-mouse.sh` performs the same two checks after registering the checkout.

## On a cloud VM (comparable, with caveats)

Task images need 15-20 GB of Docker disk and a full run takes hours, so a throwaway VM is the practical host when Runta is not available. The 24/30 run was produced this way: a GCE `e2-standard-8` with a 200 GB disk, Docker, Node 22, and Harbor installed by a startup script, the task images downloaded on the VM, and one Harbor job per task run under `tmux` with the same `MouseAgent` and the same `--ak` options as above. The VM scripts from that run are not part of this repository; the Harbor commands in "Run one task locally" are what they executed. A VM run is comparable to the leaderboard only with the caveats stated in [docs/evals.md](../docs/evals.md): same model route, same engine version, and a same-day stock OpenCode control on the same machine.

## Cost

At Kimi K3 list prices ($3/M fresh input, $0.30/M cached, $15/M output) one full 30-task run lands around $100-150. Three runs, as the claim rules require before any comparison, are roughly $300-450.
