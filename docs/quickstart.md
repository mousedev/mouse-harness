# Quickstart

## Install

```bash
npm i -g --ignore-scripts @mousedev/harness opencode-ai
```

Node 22 or newer. `opencode-ai` provides the `opencode` binary; OpenCode 1.18.27 is the version this release was benchmarked on (1.14.22 is also exercised in CI). Set up a provider once with OpenCode's own auth (`opencode auth login`) or export the provider's key (`ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `FIREWORKS_API_KEY`, and so on).

## Check the setup

```bash
cd my-repo
mouse doctor --model anthropic/claude-sonnet-5
```

`doctor` prints the Mouse version, where it found `opencode` and which version, whether that version is in the compat manifest, whether the provider's key is in the environment, whether the directory is a git repository, the checks Mouse detected (or the ones declared in `.mouse/policy.json`), and where traces will be written. It exits 1 when `opencode` cannot be found or run.

If `checks` says `none detected`, Mouse can only prove that files changed. Add a `test` script to `package.json` or declare checks in `.mouse/policy.json` ([config.md](config.md)).

## Run a task

```bash
mouse run "Add a --json flag to the CLI and cover it with tests" --model anthropic/claude-sonnet-5
```

With a terminal attached, `--format text` is the default and the output looks like this:

```
mouse 0.1.0: anthropic/claude-sonnet-5, profile local, trace /Users/me/.mouse/runs/--Users-me-my-repo--/2026-09-07T10-12-03-455Z-48213.jsonl
turn 1: 41 steps
check build: success
check test: failure
round 1 (fix): progressed, 58 steps total
check build: success
check test: success
round 2 (audit): no change, 61 steps total

<the model's final reply, ending with its MOUSE_AUDIT block>

outcome: satisfied after 2 round(s), 61 steps, 214s, $0.87
```

The exit code encodes the outcome: 0 satisfied, 3 budget (stalled, wall clock, or step ceiling), 4 blocked (a test, spec, or workflow file was deleted), 130 aborted, 1 error, 2 usage.

Long tasks can be passed as a file: `mouse run --instruction-file task.md --model ...`. `MOUSE_MODEL` in the environment replaces `--model`.

## Unattended runs

Without a terminal (CI, cron, a pipe) `--format json` is the default: OpenCode's JSON event stream is passed through on stdout unchanged and Mouse's own lines go to the trace file. Mouse also behaves as if `--yolo` was passed and prints a one-line warning on stderr, since nobody can answer a permission prompt. Pass `--yolo` explicitly to silence the warning.

```bash
mouse run --instruction-file task.md --model openrouter/moonshotai/kimi-k3 --yolo --max-wall-sec 3600
```

## Budgets

Defaults come from `.mouse/policy.json` or, without one, from `DEFAULT_POLICY`: 780 seconds of wall clock, 600 model steps, 3 non-progress rounds, and a 600 second idle watchdog per turn. Override per run with `--max-wall-sec`, `--max-steps`, `--non-progress-rounds`, `--idle-timeout-sec`. Flags win over policy.

## Where things go

- Trace: `~/.mouse/runs/--<absolute-path-of-repo>--/<timestamp>-<pid>.jsonl` (`--log FILE` or `MOUSE_HARNESS_LOG` overrides). See [trace.md](trace.md).
- Nothing is written into the repository. `.mouse/policy.json` is yours; `mouse init` creates it only if it does not exist.
- With the default `local` profile nothing is written under `~/.config/opencode` either: the OpenCode config travels in the `OPENCODE_CONFIG_CONTENT` environment variable. The one exception is the prune plugin, written only when `context.prune.enabled` is true in your policy.

## Next

- [loop.md](loop.md) for what each round does and why a run stops.
- [config.md](config.md) for every policy field, flag, and environment variable.
- [policy.md](policy.md) if you want to deny shell patterns.
