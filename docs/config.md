# Configuration

Mouse reads one file from a repository: `.mouse/policy.json`. Everything else comes from flags and environment variables. Source: `packages/core/src/policy.ts` (`DEFAULT_POLICY`, `parsePolicy`, `loadPolicy`) and `packages/cli/src/main.ts`.

## `.mouse/policy.json`

Every block is optional and every field has a default. Parsing is lenient: a missing or invalid value falls back to its default silently (numbers must be integers in range; actions must be `allow`, `ask`, or `deny`). Top-level keys Mouse does not know are preserved and ignored, so a host can add blocks of its own. `mouse init` writes a skeleton with the defaults spelled out; it never overwrites an existing file.

```json
{
  "version": 1,
  "verify": {
    "checks": null,
    "timeoutSec": 900
  },
  "loop": {
    "maxWallSec": 780,
    "maxSteps": 600,
    "nonProgressRounds": 3,
    "idleTimeoutSec": 600,
    "minRoundSec": 60
  },
  "context": {
    "prune": {
      "enabled": false,
      "thresholdChars": 8192,
      "headChars": 4096,
      "tailChars": 1024
    }
  },
  "permissions": {}
}
```

### `version`

Always `1` in this release. Any value is normalised to 1.

### `verify`

| Field | Default | Meaning |
|---|---|---|
| `checks` | `null` | The commands that define "done". `null` (or absent) means detect them from the repository's manifests (below). Two shapes are accepted: an array `[{"name": "test", "command": "pnpm test"}]`, or an object `{"test": "pnpm test", "typecheck": "pnpm typecheck"}`. Entries without a non-empty `command` string are dropped. An empty array or object declares that there are no checks, which is different from `null`. |
| `timeoutSec` | `900` | Wall clock per check, 1 to 86400. A check that exceeds it is killed and recorded with exit code `null`. |

Checks run in the workspace root through `bash -lc`, in order, after every turn in which the workspace changed. A check passes when it exits 0.

**Fallback alias.** When `policy.json` has no `verify` object (or no `policy.json` exists), Mouse reads `.mouse/app.json` and uses its `verify.checks` and `verify.timeoutSec` if present. This keeps repositories written for the hosted product working unchanged.

### Detection (when `checks` is `null`)

One shell round trip lists the manifests at the workspace root; `checksFromEcosystem` turns it into commands, in this order:

1. `package.json` scripts. Up to three checks, first present script per slot: `build` from `build` or `typecheck`; `test` from `test`; `lint` from `lint`. The package manager comes from the lockfile: `pnpm run <script>` with `pnpm-lock.yaml`, `yarn run <script>` with `yarn.lock`, otherwise `npm run <script> --if-present`.
2. `pytest`, when any of `pyproject.toml`, `pytest.ini`, `tox.ini` exists, or `setup.cfg` exists together with a `tests/` or `test/` directory. The command is `uv run --frozen pytest -q --maxfail=25 -p no:cacheprovider` with `uv.lock`, `poetry run pytest ...` with `poetry.lock`, otherwise `python3 -m pytest ...`.
3. `go-test`: `go test ./...` when `go.mod` exists.
4. `cargo-test`: `cargo test` when `Cargo.toml` exists.
5. `make-test`: `make test` when the `Makefile` has a `test:` target and nothing else was detected.

A repository with several ecosystems gets all of them. `mouse doctor` prints what was detected. Without any check, the loop can only prove that files changed.

### `loop`

| Field | Default | Meaning |
|---|---|---|
| `maxWallSec` | `780` | Total wall clock for the run, first turn included. |
| `maxSteps` | `600` | Ceiling on model steps (OpenCode `step_finish` events) across the run. |
| `nonProgressRounds` | `3` | Consecutive rounds that change nothing before the run is `stalled`. |
| `idleTimeoutSec` | `600` | A turn that prints nothing for this long is killed and retried. |
| `minRoundSec` | `60` | Reserve below which the loop will not start another round: when less than this much of `maxWallSec` remains, the run ends as `wall_clock` instead of starting a round it cannot finish. |

Flags win over policy: `--max-wall-sec` (or `MOUSE_MAX_WALL_SEC`), `--max-steps`, `--non-progress-rounds`, `--idle-timeout-sec`.

### `context.prune`

Per-result cap on tool output, applied by an OpenCode plugin when a result is produced (never by rewriting history, so the cached prefix stays intact). Anything longer than `thresholdChars` keeps its first `headChars` and last `tailChars` with an omission marker between.

| Field | Default |
|---|---|
| `enabled` | `false` |
| `thresholdChars` | `8192` |
| `headChars` | `4096` |
| `tailChars` | `1024` |

When enabled, `mouse run` writes `<config-home>/plugin/mouse-prune.mjs` (the config home is `$XDG_CONFIG_HOME/opencode` or `~/.config/opencode`, or `--config-home`). This is the one file the `local` profile writes outside `~/.mouse`. The legacy environment variable `MOUSE_TOOL_OUTPUT_PRUNE=1` also enables it, using the policy's numbers.

### `permissions`

```json
"permissions": {
  "bash": { "git push*": "deny", "rm -rf *": "deny" },
  "write": "allow",
  "edit": "allow",
  "doom_loop": "allow"
}
```

Each of `bash`, `write`, `edit` is either a single action (`allow`, `ask`, `deny`) for every call or an object mapping a pattern to an action, read in declaration order, first match wins. `doom_loop` is a single action. In this release only the `bash` deny patterns reach OpenCode; `write`, `edit`, and `doom_loop` are parsed and kept for hosts and for Phase 2. The reasoning is in [policy.md](policy.md).

## CLI flags

`mouse run` accepts the task as positional text or `--instruction-file FILE` (not both).

| Flag | Default | Meaning |
|---|---|---|
| `--model`, `-m` | `MOUSE_MODEL` | Required. `provider/model` as OpenCode names it. |
| `--workspace DIR` | current directory | The checkout to work in. |
| `--profile local\|bench` | `local` | How OpenCode is configured. `local` sends the config through `OPENCODE_CONFIG_CONTENT` and writes nothing under the config home. `bench` writes a full `opencode.json` into the config home, deep-merged over what is there (prompt, compaction, cache keys, `small_model` set to the run model, OpenRouter pinned to Fireworks, autoupdate off, share disabled). Bench is frozen: a byte change there is a benchmark change. |
| `--yolo` | off | Pass `--dangerously-skip-permissions` to OpenCode. Implied, with a warning, when stdout is not a terminal. |
| `--format text\|json` | `text` with a terminal, else `json` | `text` prints Mouse's summary lines and the final reply. `json` passes OpenCode's event stream through on stdout unchanged and prints nothing of Mouse's own. |
| `--log FILE` | `MOUSE_HARNESS_LOG`, else the default trace path | Where the JSONL trace goes. |
| `--session ID` | new session | Continue an existing OpenCode session. |
| `--max-wall-sec N` | `MOUSE_MAX_WALL_SEC`, else policy | Wall clock. |
| `--max-steps N` | policy | Step ceiling. |
| `--non-progress-rounds N` | policy | Stall limit. |
| `--idle-timeout-sec N` | policy | Idle watchdog per turn. |
| `--config-home DIR` | `$XDG_CONFIG_HOME/opencode` or `~/.config/opencode` | Where the bench profile writes `opencode.json` and where the prune plugin goes. |
| `--opencode-bin PATH` | see below | The `opencode` binary. |

`mouse config [--profile local|bench] [--model M] [--out DIR] [--workspace DIR]` prints the `local` config as JSON, or writes the `bench` file to `--out` (default: the config home) and prints the `build` agent prompt. `mouse init [--workspace DIR]` writes the policy skeleton. `mouse doctor [--model M] [--workspace DIR] [--opencode-bin PATH] [--strict-compat]` reports the environment. `mouse --version` (also `version`, `-v`) prints `mouse/<version> opencode/<version or unavailable>`.

## Environment variables

| Variable | Meaning |
|---|---|
| `MOUSE_MODEL` | Default for `--model`. |
| `MOUSE_OPENCODE_BIN` | The `opencode` binary. Resolution order: `--opencode-bin`, then this variable, then `PATH`, then the nearest `node_modules/.bin/opencode` at or above the workspace. |
| `MOUSE_HARNESS_LOG` | Default for `--log`. |
| `MOUSE_MAX_WALL_SEC` | Default for `--max-wall-sec`. |
| `MOUSE_HOME` | Replaces `~/.mouse` as the root for traces (`<MOUSE_HOME>/runs/--<cwd>--/`). |
| `MOUSE_TOOL_OUTPUT_PRUNE` | Legacy. `1` enables the prune plugin as if `context.prune.enabled` were true. Prefer the policy key. |
| `XDG_CONFIG_HOME` | Changes the default config home to `$XDG_CONFIG_HOME/opencode`. |

Provider keys (`ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `FIREWORKS_API_KEY`, and the rest) are OpenCode's concern; Mouse passes the environment through and `mouse doctor` reports whether the key for `--model`'s provider is set.

## Example

[`examples/policy-file`](../examples/policy-file) is a complete policy that declares its checks, gives long tasks an hour, enables pruning, denies three shell patterns, and carries an unknown block to show that it is preserved.
