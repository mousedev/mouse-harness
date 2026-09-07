# Mouse harness

Mouse runs OpenCode in your repo and does not stop until the repo's own checks pass.

Built on OpenCode. Mouse is an independent project and is not affiliated with or endorsed by the OpenCode project or Anomaly.

## Install

```bash
npm i -g --ignore-scripts @mousedev/harness opencode-ai
cd my-repo
mouse run "Add rate limiting to /api/upload and cover it with tests" --model provider/model
```

`--model` takes an OpenCode model id such as `anthropic/claude-sonnet-5` or `openrouter/moonshotai/kimi-k3`; `MOUSE_MODEL` in the environment works too. OpenCode 1.14.22 is the supported engine version; `mouse doctor` tells you what it found. Node 22 or newer. No configuration file is needed: checks are detected from the repository.

## How it works

A stock coding agent stops the moment the model's finish reason is not a tool call. Mouse does not trust that signal. After the first turn it runs a deterministic loop in the same OpenCode session:

1. **First turn.** Your instruction goes to OpenCode as the `build` agent with Mouse's system prompt.
2. **Probe.** Mouse fingerprints the workspace (`git status` plus a diff against the starting commit). If nothing changed, the model is told so and asked to do the task.
3. **Checks.** If files changed, Mouse runs the repository's checks: `package.json` scripts (`build` or `typecheck`, `test`, `lint`), `pytest`, `go test ./...`, `cargo test`, or `make test`, or the commands declared in `.mouse/policy.json`. Failing output goes back to the model with the instruction to fix it and never weaken a test.
4. **Tamper scan.** Deleting a test, spec, or workflow file since the start commit ends the run as `blocked`. There is no prompt that talks its way past this.
5. **Audit rounds.** When the checks pass, the model is asked to re-read every requirement and finish with a `MOUSE_AUDIT` block, one line per requirement, marked `done` with evidence or `todo`. The run is satisfied only when the workspace changed, zero checks fail, and the audit block has no `todo` items.

What stops the run: a satisfied audit (exit 0); a stall, meaning consecutive rounds that changed nothing (exit 3); the wall clock or the step ceiling (exit 3); a blocked tamper scan (exit 4); or Ctrl-C (exit 130). Each run writes a JSONL trace to `~/.mouse/runs/--<path-to-repo>--/`. Nothing is written into the repository. Details in [docs/loop.md](docs/loop.md).

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

Exit codes: 0 satisfied, 1 error, 2 usage, 3 budget (stalled, wall clock, steps), 4 blocked, 130 aborted.

`mouse init` writes a `.mouse/policy.json` skeleton. Every field has a default; see [docs/config.md](docs/config.md).

## Permissions in this release

`--yolo` passes `--dangerously-skip-permissions` to OpenCode. Without a terminal (CI, cron, a pipe) `mouse run` behaves as if `--yolo` was passed and warns once, because there is nobody to answer a prompt. With a terminal and without `--yolo`, OpenCode enforces the permission block Mouse configures for the `build` agent, which includes the `bash` deny patterns from `.mouse/policy.json` ([docs/policy.md](docs/policy.md)). An interactive mode that routes permission prompts to you, an `--auto` mode that answers them from policy, and `mouse serve` / `mouse tui` are Phase 2 and are not in this release.

## What Mouse does not do

- No plugin marketplace or skills mall. Skills stay repo-local in `.agents/skills/`, which OpenCode already reads.
- No multi-harness aggregation. One engine: OpenCode.
- No relay, accounts, billing, push notifications, hosted sandboxes, or mobile app. Those are the closed product.
- No evaluator data. Hidden task sets, raw trajectories, and internal scoring stay closed. Aggregated results and full run directories for public benchmarks ship.
- No telemetry, no install ping, no update check.
- No sandbox. Mouse runs with the permissions of the user who launched it. Run it in a container if the repository is untrusted. See [SECURITY.md](SECURITY.md).

## Benchmark

On FrontierHarness v1.0 (21 Terminal-Bench tasks plus 9 DeepSWE tasks), Mouse with Kimi K3 (via OpenRouter pinned to Fireworks) on OpenCode 1.14.22 scored 24/30 (18/21 Terminal-Bench, 6/9 DeepSWE) on 2026-09-03. That is a single run (n=1), and DeepSWE was run through the Harbor path rather than Pier, which FrontierHarness uses. For the same model, FrontierHarness's published leaderboard numbers are Codex 20/30 and stock OpenCode 15/30; those are their figures, cited as such, and were run on OpenCode 1.18.19. Three full runs at pinned versions, alongside a same-day stock OpenCode control at the same engine version and model route, are pending before this project makes any comparative claim of its own. A rerun landing a few tasks lower would not be surprising. The runbook and claim rules are in [docs/evals.md](docs/evals.md) and [evals/README.md](evals/README.md).

## Packages

| Package | What it is | Depends on |
|---|---|---|
| [`@mousedev/harness-core`](packages/core) | The completion loop, MEA audit primitives, agent prompt, ecosystem detection, policy parsing, workspace probe, trace writer. Zero runtime dependencies. | nothing |
| [`@mousedev/harness-opencode`](packages/opencode) | The OpenCode engine: `opencode run` transport, `local` and `bench` config profiles, compat manifest, tool-output prune plugin, binary location. | core, `@opencode-ai/sdk` |
| [`@mousedev/harness`](packages/cli) | The `mouse` CLI. Published as a single bundled file. | core, opencode |

The three packages share one version and are released together. `examples/` holds three workspaces that typecheck in CI: driving the loop from your own code, a policy file, and a Harbor run.

## Docs

- [docs/index.md](docs/index.md): map of the documentation
- [docs/quickstart.md](docs/quickstart.md)
- [docs/loop.md](docs/loop.md): the completion loop step by step
- [docs/config.md](docs/config.md): `.mouse/policy.json`, flags, environment variables
- [docs/policy.md](docs/policy.md): the permissions block
- [docs/audit-protocol.md](docs/audit-protocol.md): the `MOUSE_AUDIT` block
- [docs/trace.md](docs/trace.md): the JSONL trace
- [docs/opencode-compat.md](docs/opencode-compat.md): supported OpenCode versions
- [docs/evals.md](docs/evals.md): running the benchmark

## Contributing and security

[CONTRIBUTING.md](CONTRIBUTING.md) explains the issue-first rule and the review bar. [SECURITY.md](SECURITY.md) states the trust boundary and how to report privately. [CHANGELOG.md](CHANGELOG.md) is maintained by the maintainers. Licensed under MIT; see [LICENSE](LICENSE) and [NOTICE](NOTICE).
