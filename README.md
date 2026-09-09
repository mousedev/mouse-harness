<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/mouse-logo-horizontal-white.svg">
    <img src="docs/assets/mouse-logo-horizontal-black.svg" alt="Mouse" width="360">
  </picture>
</p>

<p align="center">
  An open source harness for long-running coding agents.<br>
  Mouse runs OpenCode in your repository and keeps going until the repository's own checks pass.
</p>

<p align="center">
  <a href="https://github.com/mousedev/mouse-harness/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/mousedev/mouse-harness/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-black.svg"></a>
  <img alt="Node 22+" src="https://img.shields.io/badge/node-%3E%3D22-black.svg">
  <a href="https://www.mouse.dev"><img alt="mouse.dev" src="https://img.shields.io/badge/web-mouse.dev-f54e00.svg"></a>
</p>

[Benchmark](#frontierharness-eval) · [Install](#install) · [How it works](#how-it-works) · [Commands](#commands) · [Packages](#packages) · [Docs](docs/index.md)

## FrontierHarness Eval

Mouse passed 25 of the 30 tasks on [FrontierHarness Eval](https://frontierharness.org/) with Kimi K3, run under the benchmark's own scripts on 2026-09-08.

![Pass rate against cost per pass for Mouse and the twelve published FrontierHarness configurations](evals/runs/2026-09-08-mouse-c/report/chart.svg)

| Harness | Pass rate | Cost per pass | Cache hit, median | Time per task, median |
|---|---|---|---|---|
| **Mouse 0.1.0** | **83.3%** (25/30) | **$2.79** | 90.6% | 6m 24s |
| Codex | 66.7% (20/30) | $3.47 | 88.0% | 6m 43s |
| Claude Code | 63.3% (19/30) | $18.34 | 67.8% | 9m 38s |
| DSH Creator | 63.3% (19/30) | $3.28 | 84.3% | 6m 44s |
| Pi | 60.0% (18/30) | $2.43 | 79.4% | 7m 33s |
| OpenCode | 50.0% (15/30) | $3.24 | 78.4% | 6m 27s |

The other rows are FrontierHarness's published numbers. All thirteen used the same model, Kimi K3, so the differences come from the harness. Cost per pass is the figure the leaderboard labels "median cost per task": total spend divided by passes.

How the Mouse run was made:

- FrontierHarness's own `run-trials.sh`, unmodified, at eval commit `e837a70`, on a golden checkpoint with a fresh restore for every task. Terminal-Bench through Harbor 0.22.0, DeepSWE through Pier 0.3.1.
- Harness commit [`315e2b8`](https://github.com/mousedev/mouse-harness/tree/315e2b8) on OpenCode 1.18.27. Kimi K3 served by Fireworks, the same provider as the baselines.
- All 30 trials valid, no infrastructure failures counted as passes or failures. Three of the passes (`scc-bounded-memory-spilling`, `kv-store-grpc`, `largest-eigenval`) are tasks none of the twelve published configurations solved.
- Total spend $69.76.

Mouse is not on the leaderboard yet. FrontierHarness adds a harness after reproducing the result in their environment, and the run has been submitted for that in [frontier-harness-eval/eval#12](https://github.com/frontier-harness-eval/eval/issues/12). The complete run, with every trajectory, verifier verdict, retained failed attempt, and the exact command lines, is in [`evals/runs/2026-09-08-mouse-c/`](evals/runs/2026-09-08-mouse-c/); [SUBMISSION.md](evals/runs/2026-09-08-mouse-c/SUBMISSION.md) lists every deviation from the pristine scripts. An earlier self-run on 2026-09-03 scored 24/30 through Harbor alone; it is kept under [`evals/runs/2026-09-03-k3-openrouter/`](evals/runs/2026-09-03-k3-openrouter/).

The rules this project follows when quoting a number are in [docs/evals.md](docs/evals.md). The runbook for reproducing a run is [evals/README.md](evals/README.md).

## Install

Mouse needs Node 22 and the `opencode` binary with a model provider configured. OpenCode 1.18.27 is the version the benchmark ran on; 1.14.22 is also exercised in CI.

From source, today:

```bash
git clone https://github.com/mousedev/mouse-harness && cd mouse-harness
pnpm install --frozen-lockfile --ignore-scripts
pnpm bundle                                    # -> packages/cli/dist/mouse.mjs, one file
npm i -g opencode-ai@1.18.27                   # OpenCode's postinstall links its binary; do not pass --ignore-scripts
alias mouse="node $PWD/packages/cli/dist/mouse.mjs"
```

From npm, once 0.1.1 is published:

```bash
npm i -g --ignore-scripts @mousedev/harness
npm i -g opencode-ai@1.18.27
```

Then, in a repository:

```bash
mouse doctor --model openrouter/moonshotai/kimi-k3
mouse run "Add rate limiting to /api/upload and cover it with tests" --model openrouter/moonshotai/kimi-k3
```

`doctor` shows where it found OpenCode, whether the provider key is set, and which checks Mouse detected. Any OpenCode model id works with `--model`; `MOUSE_MODEL` in the environment sets it once. The [quickstart](docs/quickstart.md) walks through a first run and what the output means.

## How it works

An engine's own loop ends the moment the model's finish reason is not a tool call. On a long task the model says "done" after a plausible first pass, and that single fact costs the run. Mouse sends your task to OpenCode's build agent, then stays in the same session and runs a completion loop after every turn:

1. **Inspect the changes.** The workspace is fingerprinted with `git status` and a diff against the starting commit. If nothing changed, the model is told so and asked to continue.
2. **Run the checks.** When files changed, the repository's checks run. Failing output goes back to the model with the instruction to fix the failure and leave the tests alone.
3. **Scan for deleted tests.** Deleting a test, spec, or workflow file that existed at the starting commit ends the run as `blocked`. The loop enforces this in code, not in the prompt.
4. **Audit the requirements.** Once the checks pass, the model is asked to go back over the original task and end its reply with a `MOUSE_AUDIT` block, one line per requirement, each marked `done` with the evidence or `todo`. Any `todo` sends it round again.

A run is `satisfied` when the workspace changed, no check failed, and the audit has no `todo` items. It stops early when progress stalls for a configurable number of rounds, when the wall clock or step budget runs out, when the deletion scan trips, or on Ctrl-C. Every stop reason has its own exit code.

Two things worth knowing before you trust the number above:

- The loop believes checks, not the model. The `MOUSE_AUDIT` block is the model's declaration that it has nothing left; it is only honoured once the checks agree. In a repository with no detectable checks, `satisfied` rests on the workspace change and that declaration alone, and the trace records it (`checksRun: []`). Declare checks in `.mouse/policy.json` to close the gap.
- The prompt and the continue prompts are frozen bytes. They are pinned by a golden test that refuses to update to make a refactor pass, because a changed byte invalidates every user's provider cache and changes the benchmark. The same bytes serve the `local` and `bench` profiles.

Each run writes a JSONL trace under `~/.mouse/runs/`, outside the repository. Nothing is written into your repository, and with the default `local` profile nothing is written under `~/.config/opencode` either.

[Completion loop](docs/loop.md) · [Audit protocol](docs/audit-protocol.md) · [Trace format](docs/trace.md)

### Repository checks

Mouse detects checks from the repository's manifests. No Mouse configuration file is needed.

| Repository | Checks |
|---|---|
| JavaScript / TypeScript | `package.json` scripts: `build` or `typecheck`, `test`, `lint`, run with the package manager the lockfile names |
| Python | `pytest`, through `uv` or `poetry` when their lockfile is present |
| Go | `go test ./...` |
| Rust | `cargo test` |
| Make | `make test`, when nothing else was detected |

To declare your own, run `mouse init`. It writes a `.mouse/policy.json` skeleton with every default spelled out; [docs/config.md](docs/config.md) has the field reference, the flags, and the environment variables.

## Commands

| Command | Purpose |
|---|---|
| `mouse run` | Run a task, from a string or `--instruction-file` |
| `mouse doctor` | Report the engine, the model's key, the git state, the detected checks, and the trace directory |
| `mouse init` | Write a `.mouse/policy.json` skeleton |
| `mouse config` | Print the OpenCode config Mouse sends (`local`), or write the `bench` profile's `opencode.json` |
| `mouse --version` | `mouse/<version> opencode/<version>` |

<details>
<summary>Flags</summary>

```
mouse run ["task" | --instruction-file F]
          [--model provider/model] [--workspace DIR]
          [--profile local|bench] [--yolo]
          [--format text|json] [--log FILE] [--session ID]
          [--max-wall-sec N] [--max-steps N]
          [--non-progress-rounds N] [--idle-timeout-sec N]
          [--config-home DIR] [--opencode-bin PATH]
mouse config [--profile local|bench] [--model M] [--out DIR]
mouse init [--workspace DIR]
mouse doctor [--model M] [--workspace DIR] [--strict-compat]
mouse --version
```

Defaults come from `.mouse/policy.json` or, without one, from the built-in policy: 780 seconds of wall clock, 600 model steps, 3 non-progress rounds, a 600 second idle watchdog per turn. Flags win over the policy file. Without a terminal, `--format json` is the default and OpenCode's event stream passes through on stdout unchanged, which is what benchmark runners parse.

</details>

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Satisfied: the workspace changed, no check failed, the audit is clean |
| 1 | Harness error |
| 2 | Invalid usage |
| 3 | Budget: stalled, wall clock, or step ceiling |
| 4 | Blocked: a test, spec, or workflow file was deleted |
| 130 | Interrupted |

## Permissions

Mouse runs with the permissions of the user who starts it and has no sandbox of its own. Use a container for a repository you do not trust.

| How you run Mouse | What OpenCode enforces |
|---|---|
| In a terminal, without `--yolo` | The build agent's permission block, including the `bash` deny patterns from `.mouse/policy.json` |
| With `--yolo` | Nothing. Mouse passes `--dangerously-skip-permissions` to OpenCode |
| Without a terminal (CI, cron, a pipe) | The same as `--yolo`, with one warning on stderr. `opencode run` reads no stdin, so a prompt could never be answered |

[Permission policy](docs/policy.md) · [Security](SECURITY.md)

## Packages

| Package | Contents | Runtime dependencies |
|---|---|---|
| [`@mousedev/harness-core`](packages/core) | The completion loop, task-state bookkeeping, the agent prompt, check detection, policy parsing, the workspace probe, the trace writer | None |
| [`@mousedev/harness-opencode`](packages/opencode) | The `opencode run` transport, the `local` and `bench` profiles, the compat manifest, the tool-output prune plugin, binary discovery | core, `@opencode-ai/sdk` |
| [`@mousedev/harness`](packages/cli) | The `mouse` command, shipped as one bundled file | core, the OpenCode adapter |

The three share a version and release together. [`examples/sdk-run`](examples/sdk-run) drives the loop from your own code in forty lines; [`examples/policy-file`](examples/policy-file) is a complete `.mouse/policy.json`; [`examples/harbor-run`](examples/harbor-run) runs one benchmark task the way FrontierHarness does.

## What Mouse is and is not

This repository is the harness: the CLI and the two packages under it. OpenCode is the only engine. Skills live in `.agents/skills/` inside your repository, which OpenCode already reads. There is no plugin system or marketplace, and no telemetry, install ping, or update check.

The hosted product at [mouse.dev](https://www.mouse.dev) adds sandboxes, a relay, and a mobile app on top of this loop. That code is separate and closed.

## Roadmap

Not in 0.1, in rough order:

- Interactive permission prompts routed to the terminal, and an `--auto` mode that answers them from the policy file.
- A deletion scan that also covers co-located test files (`src/foo.test.ts`, `x_test.go`, `conftest.py`) and check configuration.
- `mouse serve` for driving a run over a socket.

Changes to the loop, the prompt, or the profiles start as an issue; see [CONTRIBUTING.md](CONTRIBUTING.md).

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) first. It is short, and the rules about prompt bytes and the golden snapshot are the ones that matter. Report security issues privately per [SECURITY.md](SECURITY.md). Questions go to [Discussions](https://github.com/mousedev/mouse-harness/discussions) or [SUPPORT.md](SUPPORT.md).

[Documentation](docs/index.md) · [Changelog](CHANGELOG.md) · [Blog: Mouse on FrontierHarness](https://www.mouse.dev/blog/mouse-on-frontierharness)

## License

MIT. Attribution for the work Mouse builds on is in [NOTICE](NOTICE). Mouse is an independent project, not affiliated with or endorsed by OpenCode or Anomaly.
