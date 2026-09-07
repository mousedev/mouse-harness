# Mouse

An open source harness for long-running coding agents.

Mouse runs OpenCode in your repository and checks the work after each turn. When a check fails, it sends the output back to the agent to fix. Once the checks pass, the agent reviews the original requirements and reports what it completed, with evidence for each item.

Run tasks locally, on a cloud machine, or in CI. Set time and step limits for unattended runs, or use the core packages to build your own workflow.

[Quick start](#quick-start) · [How it works](#how-it-works) · [Commands](#commands) · [Benchmarks](#benchmarks) · [Docs](#docs)

## Quick start

Requires Node.js 22+ and a model provider configured in OpenCode. This release was benchmarked on OpenCode 1.18.27; 1.14.22 is also exercised in CI.

```bash
npm i -g --ignore-scripts @mousedev/harness opencode-ai@1.18.27
cd my-repo
mouse run "Add rate limiting to /api/upload and cover it with tests" \
  --model openrouter/moonshotai/kimi-k3
```

Choose an OpenCode model ID with `--model`, or set it once in your environment:

```bash
export MOUSE_MODEL="openrouter/moonshotai/kimi-k3"
mouse run "Add rate limiting to /api/upload and cover it with tests"
```

Mouse detects checks from the repository. No Mouse configuration file is required. Run `mouse doctor` to inspect the installed engine and workspace.

See the [quickstart](docs/quickstart.md) for setup details and [OpenCode compatibility](docs/opencode-compat.md) for version support.

## How it works

Mouse sends your task to OpenCode's build agent with a system prompt, then runs a completion loop in the same session:

1. **Inspect the changes.** Mouse fingerprints the workspace using `git status` and a diff against the starting commit. If nothing changed, it asks the agent to continue the task.
2. **Run the checks.** When files change, Mouse runs the repository's checks. Failed output goes back to the agent with instructions to fix the failure and preserve the tests.
3. **Check for deleted tests.** Deleting a test, spec, or workflow file relative to the starting commit blocks the run. Mouse enforces this in code.
4. **Review the requirements.** After checks pass, the agent reviews every requirement and returns a `MOUSE_AUDIT` block. Each item must be marked `done` with evidence or `todo`. Unfinished items send the agent through another round.

A run succeeds when the workspace has changed, no checks fail, and the audit marks every requirement complete. It also stops if progress stalls, a time or step limit is reached, a deletion blocks the run, or you press Ctrl-C.

Each run writes a JSONL trace under `~/.mouse/runs/--<path-to-repo>--/`. Run traces are stored outside the repository.

[Completion loop](docs/loop.md) · [Audit protocol](docs/audit-protocol.md) · [Trace format](docs/trace.md)

### Repository checks

Mouse detects checks for these ecosystems:

| Repository | Checks |
|---|---|
| JavaScript / TypeScript | Available `package.json` scripts: `build` or `typecheck`, `test`, `lint` |
| Python | `pytest` |
| Go | `go test ./...` |
| Rust | `cargo test` |
| Make | `make test` |

To declare your own commands, create a policy file:

```bash
mouse init
```

This writes a `.mouse/policy.json` skeleton. Every field has a default. See [configuration](docs/config.md) for the policy format, flags, and environment variables.

## Usage

Read a task from a file and allow up to six hours:

```bash
mouse run --instruction-file task.md \
  --model openrouter/moonshotai/kimi-k3 \
  --max-wall-sec 21600
```

The step, stall, and other stop conditions still apply.

Run against a specific workspace and return JSON:

```bash
mouse run "Fix the failing tests" \
  --workspace /path/to/repo \
  --model openrouter/moonshotai/kimi-k3 \
  --format json
```

## Commands

| Command | Purpose |
|---|---|
| `mouse run` | Run a task from a string or instruction file |
| `mouse init` | Create a repository policy file |
| `mouse config` | Generate OpenCode configuration for the local or bench profile |
| `mouse doctor` | Inspect the engine, model, and workspace |
| `mouse --version` | Print the installed version |

<details>
<summary>Command reference</summary>

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

Supply a task as a string or with `--instruction-file`. Set the model with `--model` or `MOUSE_MODEL`.

</details>

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Completion conditions satisfied |
| 1 | Runtime error |
| 2 | Invalid usage |
| 3 | Stalled or reached the wall-clock or step limit |
| 4 | Blocked by the deletion scan |
| 130 | Interrupted |

## Permissions

Mouse runs with the permissions of the user who starts it. It does not provide a sandbox. Use a container for untrusted repositories.

| How you run Mouse | Permission behavior |
|---|---|
| In a terminal, without `--yolo` | OpenCode enforces the configured build agent permissions, including bash deny patterns from `.mouse/policy.json` |
| With `--yolo` | Mouse passes `--dangerously-skip-permissions` to OpenCode |
| Without a terminal, including CI, cron, or a pipe | Mouse automatically enables the same behavior as `--yolo` and prints a warning |

Interactive permission forwarding, policy-based `--auto` approvals, `mouse serve`, and `mouse tui` are planned for Phase 2. They are not available in this release.

[Permission policy](docs/policy.md) · [Security](SECURITY.md)

## Benchmarks

Mouse completed 24 of 30 tasks in a single FrontierHarness v1.0 run on September 3, 2026.

| Task set | Completed |
|---|---|
| Terminal-Bench | 18 / 21 |
| DeepSWE | 6 / 9 |
| **Total** | **24 / 30** |

The run used Kimi K3 through OpenRouter, pinned to Fireworks, with OpenCode 1.18.27 (the adapter installed opencode-ai@latest that day). DeepSWE ran through Harbor; FrontierHarness uses Pier.

For the same model, FrontierHarness publishes scores of 20/30 for Codex and 15/30 for stock OpenCode. These are their results. Their published OpenCode engine version is 1.18.19, so the runs do not provide a controlled comparison.

Three full runs at pinned versions and a same-day stock OpenCode control using the same engine version and model route are pending. The current Mouse result is one run (n=1), and does not establish a consistent lead.

Public benchmark releases include aggregate results and full run directories. Internal evaluation task sets, raw trajectories, and scoring remain private.

See the [evaluation methodology](docs/evals.md) and [runbook](evals/README.md) for reproduction steps and reporting rules.

## Packages

| Package | Contents | Runtime dependencies |
|---|---|---|
| [`@mousedev/harness-core`](packages/core) | Completion loop, MEA audit primitives, agent prompt, ecosystem detection, policy parsing, workspace probe, and trace writer | None |
| [`@mousedev/harness-opencode`](packages/opencode) | `opencode run` transport, local and bench profiles, compatibility manifest, tool-output pruning plugin, and binary discovery | Core, `@opencode-ai/sdk` |
| [`@mousedev/harness`](packages/cli) | The `mouse` CLI, published as a single bundled file | Core, OpenCode adapter |

All three packages share a version and are released together. The examples cover using the loop from code, writing a policy file, and running through Harbor. All three example workspaces typecheck in CI.

## Project scope

This repository contains the CLI and harness packages. OpenCode is the only engine. Skills live in `.agents/skills/` inside your repository, which OpenCode already reads; Mouse has no plugin or skills marketplace.

The hosted sandboxes, relay, accounts, billing, push notifications, and mobile app belong to the separate closed-source Mouse product.

The harness has no telemetry, install pings, or update checks.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. It covers the issue-first process and review requirements. Report security issues privately using [SECURITY.md](SECURITY.md).

[Documentation](docs/index.md) · [Changelog](CHANGELOG.md)

## License

MIT. See [NOTICE](NOTICE) for attribution.

---

Mouse is built on OpenCode. It is an independent project, not affiliated with or endorsed by OpenCode or Anomaly.
