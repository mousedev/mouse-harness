# The trace

Source: `packages/core/src/trace.ts` (record types, `openTrace`, `parseTrace`) and `packages/core/src/paths.ts` (where the file goes).

## Location

Mouse keeps its own state under `~/.mouse/runs/--<cwd>--/`, never inside the repository. The slug is the absolute workspace path with every run of `/`, `\`, or `:` replaced by `-` and wrapped in double dashes, so `/Users/me/repo` becomes `--Users-me-repo--`.

- Default file: `~/.mouse/runs/--<cwd>--/<ISO timestamp with ':' and '.' replaced by '-'>-<pid>.jsonl`, for example `2026-09-07T10-12-03-455Z-48213.jsonl`.
- `--log FILE` or `MOUSE_HARNESS_LOG` names the file instead.
- `MOUSE_HOME` replaces `~/.mouse`.

The directory is created on first write. Records are appended one JSON object per line.

## Records

Every record carries `ts` (epoch milliseconds, added at write time) and `type`. The first record is `mouse.start`, which carries the trace version `v: 1` (`TRACE_VERSION`). Readers should ignore record types they do not know.

| `type` | Written | Fields |
|---|---|---|
| `mouse.start` | once, before the first turn | `v`, `version` (Mouse), `model`, `workspace`, `profile`, `runStartSha` (`null` outside git), `maxWallSec`, `configFile` (bench profile only: the `opencode.json` written) |
| `mouse.attempt` | by the engine, per `opencode run` process | `attempt` (1-based within the turn), `steps`, `exitCode` (`null` if killed), `timedOut`, `transientError`, `error` (first 500 characters of an OpenCode `error` event, or `null`), `sessionId` |
| `mouse.turn` | after the first turn | `steps` (engine total), `tokens`, `sessionId` |
| `mouse.event` | per loop event | `event`: `{type:"check_status", name, conclusion:"success"|"failure", detail?, retryable?}` or `{type:"notice", message, level?}` |
| `mouse.round` | after each continue turn | the `CompletionRound`: `round`, `kind` (`fix`, `nochange`, `audit`), `checksFailed` (names), `changed`, `audit` (the parsed model block before this round, or `null`), `progressed`, `stepsAfter`, `elapsedMs`, `model` |
| `mouse.done` | when the loop returns | `outcome`, `rounds` (count), `totalSteps`, `tokens`, `elapsedMs`, `sessionId` |
| `mouse.error` | when the harness itself fails | `error`, `steps`, `elapsedMs` |

`tokens` is `{input, output, cacheRead, cacheWrite, cost}` summed from OpenCode's `step_finish` events; `cost` is USD as reported by OpenCode and 0 when it does not price the model.

A trace ends with exactly one of `mouse.done` or `mouse.error`. The benchmark adapters use that to tell a finished trial from a crashed harness: OpenCode `error` events inside a trial are not a crash if the loop recovered and reached `mouse.done`.

## Example

```
{"ts":1788000000000,"type":"mouse.start","v":1,"version":"0.1.0","model":"anthropic/claude-sonnet-5","workspace":"/Users/me/repo","profile":"local","runStartSha":"3f1c...","maxWallSec":780}
{"ts":1788000031000,"type":"mouse.attempt","attempt":1,"steps":41,"exitCode":0,"timedOut":false,"transientError":false,"error":null,"sessionId":"ses_01"}
{"ts":1788000031001,"type":"mouse.turn","steps":41,"tokens":{"input":120000,"output":9000,"cacheRead":80000,"cacheWrite":0,"cost":0.61},"sessionId":"ses_01"}
{"ts":1788000040000,"type":"mouse.event","event":{"type":"check_status","name":"test","conclusion":"failure","detail":"FAIL test/cli.test.ts ...","retryable":true}}
{"ts":1788000100000,"type":"mouse.attempt","attempt":1,"steps":17,"exitCode":0,"timedOut":false,"transientError":false,"error":null,"sessionId":"ses_01"}
{"ts":1788000100001,"type":"mouse.round","round":1,"kind":"fix","checksFailed":["test"],"changed":true,"audit":null,"progressed":true,"stepsAfter":58,"elapsedMs":100001,"model":"anthropic/claude-sonnet-5"}
{"ts":1788000110000,"type":"mouse.event","event":{"type":"check_status","name":"test","conclusion":"success"}}
{"ts":1788000130000,"type":"mouse.round","round":2,"kind":"audit","checksFailed":[],"changed":true,"audit":null,"progressed":false,"stepsAfter":61,"elapsedMs":130001,"model":"anthropic/claude-sonnet-5"}
{"ts":1788000140000,"type":"mouse.done","outcome":"satisfied","rounds":2,"totalSteps":61,"tokens":{"input":150000,"output":11000,"cacheRead":110000,"cacheWrite":0,"cost":0.87},"elapsedMs":140001,"sessionId":"ses_01"}
```

## Reading traces

`parseTrace(text)` from `@mousedev/harness-core` returns the records of a file as objects and skips malformed lines. `evals/harbor/mouse_logs.py` is the Python equivalent the benchmark adapters use; `evals/report.py` summarises a job directory from the traces and OpenCode's event stream.

## Not in this release

The plan reserves a `mouse.permission` record for interactive permission decisions. It is Phase 2 and no code writes it yet.
