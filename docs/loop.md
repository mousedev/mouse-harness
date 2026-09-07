# The completion loop

Source: `packages/core/src/loop.ts` (`runCompletionLoop`), with the probe in `packages/core/src/probe.ts` and the deterministic auditor in `packages/core/src/mea.ts`. The loop is pure: it takes a probe (four functions over the workspace), an engine that can accept a prompt, a budget, and callbacks. The CLI wires it to a local checkout and to `opencode run`.

## Why it exists

An engine's own loop ends the moment the model's finish reason is not a tool call. On long tasks that single fact costs the run: the model says "done" after a plausible first pass. Mouse keeps going, in the same session, until the environment says the task is done.

## Before the loop

`mouse run` does this before the first turn:

1. Loads `.mouse/policy.json` (with `.mouse/app.json#verify` as a fallback alias for the checks).
2. Records the starting commit (`git rev-parse HEAD`, or `null` outside a repository) and touches a marker file in the temp directory for the non-git fallback.
3. Takes the initial workspace fingerprint.
4. Writes the `mouse.start` trace record.
5. Sends your instruction to OpenCode as the first turn (`opencode run --format=json --agent build --model ...`). The system prompt is Mouse's `build` prompt, delivered through the OpenCode config; the instruction itself is sent unchanged.

## Each round

The loop then iterates. Round `n` does the following, in order.

1. **Budget gates.** If the abort signal fired: `aborted`. If elapsed time since the run started is at or above `maxWallMs`: `wall_clock`. If the engine's step count is at or above `maxTotalSteps`: `step_budget`. The first turn counts against both.
2. **Fingerprint.** `changed` is true when the fingerprint differs from the initial one. In a git repository the fingerprint is `git status --porcelain` plus `git diff --shortstat <start-sha>`; outside one it is the sorted list of files newer than the marker (excluding `.git/` and `node_modules/`, capped at 2000 entries).
3. **Checks and tamper scan, only if `changed`.** An unchanged workspace skips both. Each check runs in the workspace with the policy's `verify.timeoutSec` (default 900 seconds); a timeout is recorded as exit code `null`. The last 1500 characters of combined output are kept as the excerpt. Every check produces a `check_status` event.
4. **Blocked.** If the tamper scan lists any file, the loop emits a `notice` naming up to five of them and returns `blocked`. The scan is `git diff --diff-filter=D --name-only <start-sha>` filtered to paths matching `(^|/)(tests?|spec|__tests__)(/|$)` or `.github/workflows/`. It detects deletions only, and only in a git repository with a known start commit.
5. **Deterministic audit.** `auditFromSandboxProbe` turns the probe evidence (changed, head SHA, check results, tampering) into an `AuditReport` and `applyAudit` folds it into the `TaskState`. This is the MEA bookkeeping: requirement records advance only on environment evidence, never on what the model said. The state is returned with the result and its requirement list appears in every continue prompt.
6. **Satisfied test.** The last assistant text of the most recent turn is parsed for a `MOUSE_AUDIT` block ([audit-protocol.md](audit-protocol.md)). The loop returns `satisfied` when all three hold: the workspace changed, zero checks failed, and a block is present with zero `todo` items.
7. **Pick the round kind.**
   - `nochange`: the workspace has not changed since the run started.
   - `fix`: it changed and at least one check failed.
   - `audit`: it changed and every check passed, but the model has not produced a clean audit block.
8. **Reserve.** If less than `MIN_ROUND_MS` (60 seconds, a constant in `loop.ts`) of wall clock remains, the loop returns `wall_clock` instead of starting a round it cannot finish.
9. **Escalation.** If two or more consecutive rounds made no progress and the caller supplied an `escalate` callback, it may return a new model id for the rest of the run. The CLI does not supply one in this release; the SDK can.
10. **Continue prompt.** `buildContinuePrompt(kind, ...)` is sent to the same session. It carries, in order: the kind-specific opener (failing check names, commands, exit codes, and excerpts for `fix`; the "nothing changed" instruction for `nochange`; the "re-read each requirement" instruction plus the model's own previous `todo` items for `audit`), the `## Requirements` list from the task state, the `## Original task` (first 6000 characters), and the audit footer asking for a `MOUSE_AUDIT` block.
11. **Progress.** After the turn, the fingerprint is taken again. `progressed` is true when it differs from the fingerprint at the top of this round. The non-progress counter resets on progress and increments otherwise. The round record (`mouse.round` in the trace) is written.
12. **Stall.** An audit round that edits nothing but reports everything done is not a stall: the next iteration will exit `satisfied`. Otherwise, when the non-progress counter reaches `maxNonProgressRounds`, the loop returns `stalled`.

Because the audit footer is only part of the continue prompts, a run that finishes the whole task in the first turn still gets one `audit` round before it can be satisfied.

## Outcomes and exit codes

| Outcome | Meaning | `mouse run` exit code |
|---|---|---|
| `satisfied` | changed, zero failing checks, clean audit block | 0 |
| `stalled` | `nonProgressRounds` consecutive rounds changed nothing | 3 |
| `wall_clock` | `maxWallSec` reached, or under 60 seconds left | 3 |
| `step_budget` | `maxSteps` model steps reached | 3 |
| `blocked` | a test, spec, or workflow file was deleted | 4 |
| `aborted` | SIGINT or SIGTERM | 130 |

A harness error (OpenCode missing, a turn that produced no steps after three attempts) exits 1 and writes a `mouse.error` record.

## The engine's part

`OpencodeRunEngine` (`packages/opencode/src/run-engine.ts`) spawns one `opencode run` process per turn and continues the session with `--session <id>` after the first. It counts `step_finish` events, sums tokens and cost, and keeps the last `text` parts as the assistant text. A turn that prints nothing for `idleTimeoutSec` (default 600) is killed; a turn that dies with a transient provider error, or exits non-zero, before its first step is retried on the same session with backoff (2, 4, 8 seconds, capped at 30), up to three attempts. A turn that did real work is accepted even if the process exited non-zero. Each attempt is a `mouse.attempt` trace record.

## Budgets

| Budget | Source | Default |
|---|---|---|
| wall clock | `--max-wall-sec`, `MOUSE_MAX_WALL_SEC`, `loop.maxWallSec` | 780 s |
| steps | `--max-steps`, `loop.maxSteps` | 600 |
| non-progress rounds | `--non-progress-rounds`, `loop.nonProgressRounds` | 3 |
| idle per turn | `--idle-timeout-sec`, `loop.idleTimeoutSec` | 600 s |
| per check | `verify.timeoutSec` | 900 s |

Spend follows evidence of progress, not a fixed round count. There is no maximum number of rounds other than what the wall clock and the step ceiling imply.
