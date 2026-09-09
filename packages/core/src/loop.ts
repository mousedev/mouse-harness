/**
 * Completion loop: the harness keeps going after the model says "done".
 *
 * Every DeepSWE pass on FrontierHarness took 73-358 turns and ended with the
 * repo's suite green; an engine's own loop ends the moment the model's finish
 * reason is not `tool-calls`, and that single fact costs it every long task.
 * After each turn this loop probes the workspace deterministically (did
 * anything change, do the checks pass, was anything tampered with), then
 * either stops with evidence or continues in the same session with the
 * failing output and an audit request.
 *
 * Spend follows evidence of progress, never a fixed round count: the loop
 * stops on a satisfied audit, on the wall clock, on a step ceiling far above
 * the field's maximum, or when consecutive rounds change nothing.
 *
 * Pure: it needs a probe (four functions over the workspace), an engine that
 * can take a prompt, and callbacks. No filesystem, no network.
 */
import type { Engine } from "./engine.js";
import type { LoopEvent } from "./events.js";
import { applyAudit, auditFromSandboxProbe, initTaskState, type TaskState } from "./mea.js";

export interface CheckResult {
  name: string;
  command: string;
  pass: boolean;
  /** `null` when the check timed out. */
  exitCode: number | null;
  excerpt: string;
}

export interface CompletionProbe {
  /** Run the repo's declared or detected checks. Empty when none exist. */
  checks(): Promise<CheckResult[]>;
  /** Test, spec, and workflow files deleted since the run started. */
  tampering(): Promise<string[]>;
  /** Stable digest of the workspace state; any edit changes it. */
  fingerprint(): Promise<string>;
}

export interface CompletionBudget {
  maxWallMs: number;
  maxTotalSteps: number;
  maxNonProgressRounds: number;
  /** A round needs at least this long to be worth starting. Defaults to `MIN_ROUND_MS`. */
  minRoundMs?: number;
}

export type CompletionOutcome =
  | "satisfied"
  | "stalled"
  | "wall_clock"
  | "step_budget"
  | "blocked"
  | "aborted";

export type ContinueKind = "fix" | "nochange" | "audit";

export interface CompletionRound {
  round: number;
  kind: ContinueKind;
  checksFailed: string[];
  changed: boolean;
  /** Parsed from the model's MOUSE_AUDIT block before this round, if any. */
  audit: ModelAudit | null;
  progressed: boolean;
  stepsAfter: number;
  elapsedMs: number;
  model: string;
}

export interface CompletionResult {
  outcome: CompletionOutcome;
  rounds: CompletionRound[];
  totalSteps: number;
  state: TaskState;
}

export interface ModelAudit {
  done: string[];
  todo: string[];
}

export interface RunCompletionLoopInput {
  probe: CompletionProbe;
  engine: Pick<Engine, "prompt">;
  /** Session the first turn ran in; every continue prompt goes to it. */
  sessionId: string;
  /** Model the session runs; `escalate` may replace it. */
  model: string;
  signal: AbortSignal;
  instruction: string;
  onEvent?: (e: LoopEvent) => void | Promise<void>;
  budget: CompletionBudget;
  /** Epoch ms when the task started (the first turn counts against the clock). */
  startedAt: number;
  /** Probe fingerprint taken before the first turn. */
  initialFingerprint: string;
  /** Total model steps so far, engine-tracked. */
  steps: () => number;
  /** Final assistant text of the most recent turn. */
  lastAssistantText: () => string;
  /** Optional model ladder: after repeated non-progress, return a model id to switch to. */
  escalate?: (nonProgressRounds: number) => Promise<string | null>;
  onRound?: (round: CompletionRound) => void | Promise<void>;
  now?: () => number;
}

/** A round needs at least this long to be worth starting. */
export const MIN_ROUND_MS = 60_000;
const INSTRUCTION_MAX_CHARS = 6_000;
const EXCERPT_MAX_CHARS = 1_500;

export const AUDIT_OPEN = "MOUSE_AUDIT";
export const AUDIT_CLOSE = "END_MOUSE_AUDIT";

/**
 * Parse the model's self-audit. Format, one line per requirement:
 *   MOUSE_AUDIT
 *   - [done] <requirement>: <evidence>
 *   - [todo] <requirement>: <what is missing>
 *   END_MOUSE_AUDIT
 * `[x]` / `[ ]` are accepted as done / todo. Returns null without a block.
 */
export function parseAuditBlock(text: string): ModelAudit | null {
  // The opener is a substring of the closer, so walk back past any
  // `END_MOUSE_AUDIT` to the last real opener.
  let open = text.lastIndexOf(AUDIT_OPEN);
  while (open > 0 && text.startsWith(AUDIT_CLOSE, open - "END_".length)) {
    open = text.lastIndexOf(AUDIT_OPEN, open - 1);
  }
  if (open < 0) return null;
  const closeAt = text.indexOf(AUDIT_CLOSE, open + AUDIT_OPEN.length);
  const body = text.slice(open + AUDIT_OPEN.length, closeAt < 0 ? undefined : closeAt);
  const done: string[] = [];
  const todo: string[] = [];
  for (const raw of body.split("\n")) {
    const m = /^\s*[-*]\s*\[(done|todo|x|X| )\]\s*(.*)$/.exec(raw);
    if (!m) continue;
    const item = m[2]!.trim();
    if (m[1] === "done" || m[1] === "x" || m[1] === "X") done.push(item);
    else todo.push(item);
  }
  if (done.length === 0 && todo.length === 0) return null;
  return { done, todo };
}

function auditFooter(): string {
  return [
    "When you are finished, end your reply with an audit of the original task, one line per requirement, in exactly this form:",
    AUDIT_OPEN,
    "- [done] <requirement>: <the file, test, or command output that proves it>",
    "- [todo] <requirement>: <what is still missing>",
    AUDIT_CLOSE,
    "Mark a requirement done only with evidence you produced in this workspace.",
  ].join("\n");
}

function requirementLines(state: TaskState): string[] {
  return state.requirements.map((r) => `- ${r.text}`);
}

export function buildContinuePrompt(
  kind: ContinueKind,
  ctx: {
    instruction: string;
    state: TaskState;
    failed: CheckResult[];
    audit: ModelAudit | null;
  },
): string {
  const lines: string[] = [];
  if (kind === "fix") {
    lines.push("Verification failed after your changes.", "");
    for (const c of ctx.failed) {
      lines.push(
        `Check \`${c.name}\` (\`${c.command}\`) ${c.exitCode == null ? "timed out" : `exited ${c.exitCode}`}:`,
        "```",
        c.excerpt.slice(-EXCERPT_MAX_CHARS),
        "```",
        "",
      );
    }
    lines.push(
      "Continue working on the task. Do not stop until these checks pass and every requirement below is done. Never weaken, skip, or delete tests to make them pass.",
    );
  } else if (kind === "nochange") {
    lines.push(
      "No files in the workspace have changed, so the task is not done. Read the task again, then implement it here. If the task only requires producing files or output, produce them now.",
    );
  } else {
    lines.push(
      "Before finishing, verify the task is complete. Re-read each requirement below and confirm it is implemented and checked in this workspace. If anything is missing, untested, or only partially done, do it now.",
    );
    if (ctx.audit && ctx.audit.todo.length > 0) {
      lines.push("", "You previously listed these as not done:");
      for (const t of ctx.audit.todo) lines.push(`- ${t}`);
    }
  }
  lines.push("", "## Requirements", ...requirementLines(ctx.state));
  lines.push("", "## Original task", ctx.instruction.slice(0, INSTRUCTION_MAX_CHARS));
  lines.push("", auditFooter());
  return lines.join("\n");
}

export async function runCompletionLoop(input: RunCompletionLoopInput): Promise<CompletionResult> {
  const now = input.now ?? Date.now;
  const { probe, budget, signal } = input;
  const onEvent = input.onEvent ?? (() => {});
  let state = initTaskState(input.instruction);
  const targets = state.requirements.map((r) => r.id);
  const rounds: CompletionRound[] = [];
  let nonProgress = 0;
  let model = input.model;

  const finish = (outcome: CompletionOutcome): CompletionResult => ({
    outcome,
    rounds,
    totalSteps: input.steps(),
    state,
  });

  for (let round = 1; ; round++) {
    if (signal.aborted) return finish("aborted");
    const elapsed = now() - input.startedAt;
    if (elapsed >= budget.maxWallMs) return finish("wall_clock");
    if (input.steps() >= budget.maxTotalSteps) return finish("step_budget");

    const fp = await probe.fingerprint();
    const changed = fp !== input.initialFingerprint;
    const checks = changed ? await probe.checks() : [];
    const tampering = changed ? await probe.tampering() : [];
    for (const c of checks) {
      await onEvent({
        type: "check_status",
        name: c.name,
        conclusion: c.pass ? "success" : "failure",
        ...(c.pass ? {} : { detail: c.excerpt.slice(-EXCERPT_MAX_CHARS), retryable: true }),
      });
    }
    if (tampering.length > 0) {
      await onEvent({
        type: "notice",
        message: `Verification files were deleted: ${tampering.slice(0, 5).join(", ")}`,
        level: "warn",
      });
      return finish("blocked");
    }

    const audit = auditFromSandboxProbe({
      state,
      contractTargets: targets,
      workspaceChanged: changed,
      checks,
      tampering,
    });
    state = applyAudit(state, audit);

    const failed = checks.filter((c) => !c.pass);
    const modelAudit = parseAuditBlock(input.lastAssistantText());
    if (changed && failed.length === 0 && modelAudit && modelAudit.todo.length === 0) {
      return finish("satisfied");
    }

    const kind: ContinueKind = !changed ? "nochange" : failed.length > 0 ? "fix" : "audit";
    if (budget.maxWallMs - elapsed < (budget.minRoundMs ?? MIN_ROUND_MS))
      return finish("wall_clock");

    if (nonProgress >= 2 && input.escalate) {
      const next = await input.escalate(nonProgress);
      if (next) model = next;
    }

    const prompt = buildContinuePrompt(kind, {
      instruction: input.instruction,
      state,
      failed,
      audit: modelAudit,
    });
    try {
      await input.engine.prompt(input.sessionId, prompt, signal, { model });
    } catch (e) {
      if ((e as Error)?.name === "AbortError" || signal.aborted) return finish("aborted");
      throw e;
    }

    const after = await probe.fingerprint();
    const progressed = after !== fp;
    nonProgress = progressed ? 0 : nonProgress + 1;
    const record: CompletionRound = {
      round,
      kind,
      checksFailed: failed.map((c) => c.name),
      changed,
      audit: modelAudit,
      progressed,
      stepsAfter: input.steps(),
      elapsedMs: now() - input.startedAt,
      model,
    };
    rounds.push(record);
    await input.onRound?.(record);

    // An audit round that edits nothing but reports everything done is not a
    // stall: the next iteration exits satisfied. Only repeated rounds that
    // neither edit nor claim completion count.
    const claimedDone = parseAuditBlock(input.lastAssistantText());
    if (!progressed && claimedDone && claimedDone.todo.length === 0 && failed.length === 0) {
      continue;
    }
    if (nonProgress >= budget.maxNonProgressRounds) return finish("stalled");
  }
}
