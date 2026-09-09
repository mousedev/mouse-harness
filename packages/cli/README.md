# @mousedev/harness

Mouse runs OpenCode in your repo and does not stop until the repo's own checks pass. This package is the `mouse` command: it loads `.mouse/policy.json`, detects the repository's checks, starts an OpenCode session with Mouse's configuration, and drives the completion loop from `@mousedev/harness-core` until the run is satisfied, stalled, out of budget, blocked, or aborted. The exit code encodes the outcome and a JSONL trace is written under `~/.mouse/runs/`. Nothing is written into the repository, and with the default `local` profile nothing is written under `~/.config/opencode` either.

The package ships as a single bundled file (`dist/mouse.mjs`, built with `pnpm bundle`) that runs anywhere Node 22 does; the benchmark adapters upload that same file into task containers. OpenCode itself is installed separately (`npm i -g opencode-ai`; its postinstall links the binary, so do not pass --ignore-scripts to it); 1.18.27 is the benchmarked version and 1.14.22 is also exercised in CI. Built on OpenCode; Mouse is an independent project and is not affiliated with or endorsed by the OpenCode project or Anomaly.

## Install and run

```bash
npm i -g --ignore-scripts @mousedev/harness
npm i -g opencode-ai@1.18.27
cd my-repo
mouse run "Add rate limiting to /api/upload and cover it with tests" --model provider/model
```

## Commands

```
mouse run "task" | --instruction-file F   --model provider/model [--workspace DIR]
         [--profile local|bench] [--yolo] [--format text|json] [--log FILE] [--session ID]
         [--max-wall-sec N] [--max-steps N] [--non-progress-rounds N] [--idle-timeout-sec N]
         [--config-home DIR] [--opencode-bin PATH]
mouse config [--profile local|bench] [--model M] [--out DIR]
mouse init [--workspace DIR]
mouse doctor [--model M] [--workspace DIR] [--strict-compat]
mouse --version
```

| Command | What it does |
|---|---|
| `run` | One OpenCode session through the completion loop. `--format text` (default with a terminal) prints Mouse's summary lines and the final reply; `--format json` (default without one) passes OpenCode's event stream through on stdout unchanged. `--yolo` passes `--dangerously-skip-permissions` to OpenCode and is implied, with a warning, when there is no terminal. |
| `config` | Print the `local` OpenCode config as JSON, or write the `bench` `opencode.json` to `--out` (default: the config home) and print the `build` agent prompt. |
| `init` | Write a `.mouse/policy.json` skeleton with the defaults spelled out and two example `bash` denies. Never overwrites. |
| `doctor` | Report the Mouse version, the `opencode` binary and version, the compat verdict, the provider key for `--model`, the git state, the detected or declared checks, and the trace directory. Exits 1 if `opencode` is missing; `--strict-compat` also exits 1 on an untested version. |
| `--version` | `mouse/<version> opencode/<version or unavailable>`. |

Exit codes: 0 satisfied, 1 error, 2 usage, 3 budget (stalled, wall clock, steps), 4 blocked, 130 aborted. In a repository with no detectable or declared checks, exit 0 means the workspace changed and the model reported every requirement done; the trace's `checksRun` field records that no check backed it.

Environment: `MOUSE_MODEL`, `MOUSE_OPENCODE_BIN`, `MOUSE_HARNESS_LOG`, `MOUSE_MAX_WALL_SEC`, `MOUSE_HOME`, and the legacy `MOUSE_TOOL_OUTPUT_PRUNE`. Full reference in [docs/config.md](../../docs/config.md); the loop in [docs/loop.md](../../docs/loop.md); the trace in [docs/trace.md](../../docs/trace.md).

Interactive permission prompts, `--auto`, `mouse serve`, and `mouse tui` are not in 0.1; see the roadmap in the [repository README](../../README.md#roadmap).

MIT.
