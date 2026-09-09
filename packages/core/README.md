# @mousedev/harness-core

The Mouse completion loop and everything it needs, with zero runtime dependencies. After each model turn the loop probes the workspace deterministically (did anything change, do the repository's checks pass, was a test or workflow file deleted), then either stops with evidence or sends a continue prompt to the same session with the failing output and a request for a structured `MOUSE_AUDIT` self-audit. It is engine-agnostic: an `Engine` is anything that can take a prompt and report steps and text, and a `Workspace` is a directory plus a way to run a shell command in it.

This package is what a host embeds. The CLI in `@mousedev/harness` wires it to a local checkout and to `opencode run` through `@mousedev/harness-opencode`; a hosted product wires the same functions to its own sandbox. Nothing here touches the network, and the only filesystem writes are the trace file under `~/.mouse/runs/` and the temp marker the CLI creates. Prompt bytes in `prompt.ts` and `loop.ts` are cache-sensitive and pinned by a golden test; see [AGENTS.md](../../AGENTS.md) before editing them.

## Main API

```ts
import {
  localWorkspace, loadPolicy, headSha, makeProbe, runCompletionLoop,
  openTrace, traceFile, parseAuditBlock, buildContinuePrompt, buildAgentPrompt,
  DEFAULT_POLICY, parsePolicy, permissionRulesForTool,
  detectEcosystem, checksFromEcosystem, classifyInferenceFailure,
} from "@mousedev/harness-core";
```

| Module | Exports |
|---|---|
| `loop.ts` | `runCompletionLoop(input)`, `buildContinuePrompt(kind, ctx)`, `parseAuditBlock(text)`, `MIN_ROUND_MS`, types `CompletionProbe`, `CompletionBudget`, `CompletionOutcome`, `ContinueKind`, `CompletionRound`, `CompletionResult` |
| `engine.ts` | `Engine`, `PromptResult`, `PromptOptions`, `TokenTotals` |
| `workspace.ts`, `exec.ts` | `Workspace`, `localWorkspace({ root })`, `shellPath`, `LOCAL_EXEC_TIMEOUT_CODE` |
| `probe.ts` | `makeProbe({ workspace, runStartSha, marker, signal, checks?, checkTimeoutMs? })` |
| `policy.ts` | `DEFAULT_POLICY`, `parsePolicy`, `loadPolicy(ws)`, `parseChecks`, `parsePermissions`, `permissionRulesForTool` |
| `detect.ts` | `detectEcosystem(ws)`, `checksFromEcosystem`, `checksFromPackageJson`, `pytestCommand`, `detectEcosystemCommand` |
| `git.ts` | `headSha`, `fingerprint`, `deletedVerificationFiles`, `VERIFICATION_PATH` |
| `mea.ts` | `initTaskState`, `applyAudit`, `auditFromSandboxProbe`, types `TaskState`, `AuditReport` |
| `prompt.ts` | `buildAgentPrompt(mode, { profile })`, `AGENT_PROMPT_MAX_CHARS`, types `Mode`, `Profile` |
| `trace.ts`, `paths.ts` | `openTrace(file)`, `parseTrace(text)`, `TRACE_VERSION`, `mouseHome`, `runsDir`, `traceFile`, `workspaceSlug` |
| `events.ts` | `LoopEvent` |
| `version.ts` | `MOUSE_VERSION` |
| `failures.ts` | `classifyInferenceFailure(message, raw?)` |

A complete example that drives the loop from your own code is [`examples/sdk-run`](../../examples/sdk-run/src/run.ts). The loop's behaviour, step by step, is in [docs/loop.md](../../docs/loop.md); the policy file in [docs/config.md](../../docs/config.md).

Requires Node 22 or newer. MIT.
