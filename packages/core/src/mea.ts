/**
 * Task-state bookkeeping for the completion loop, after the Manage, Execute,
 * Audit design in LongHorizon-Harness (arXiv:2608.01964): the state lives
 * outside the model, and a requirement advances only on evidence the
 * environment produced (a changed workspace, a passing check, a clean tamper
 * scan), never on what the model said.
 *
 * `initTaskState` splits the instruction into requirement records,
 * `auditFromSandboxProbe` turns one round of probe evidence into an
 * `AuditReport`, and `applyAudit` folds that report into the state. The loop
 * in `loop.ts` calls the three in that order every round.
 */

export type RecordStatus = "pending" | "completed" | "blocked" | "untrusted";

export type TaskRequirement = {
  id: string;
  text: string;
  status: RecordStatus;
  /** Audit evidence ids or short excerpts supporting status. */
  evidenceRefs: string[];
};

export type TaskArtifact = {
  id: string;
  path: string;
  status: RecordStatus;
  evidenceRefs: string[];
};

export type TaskFact = {
  id: string;
  text: string;
  status: RecordStatus;
  evidenceRefs: string[];
};

export type TaskState = {
  objective: string;
  requirements: TaskRequirement[];
  artifacts: TaskArtifact[];
  facts: TaskFact[];
  round: number;
};

export type AuditCompletion = "complete" | "incomplete" | "blocked";
export type AuditIntegrity = "clean" | "suspect" | "violation";

export type AuditReport = {
  completion: AuditCompletion;
  integrity: AuditIntegrity;
  /** Requirement ids the auditor marks completed (only when integrity=clean). */
  completedRequirementIds: string[];
  /** Requirement ids still unmet. */
  unmetRequirementIds: string[];
  facts: { text: string; evidenceRef: string }[];
  gaps: string[];
  summary: string;
};

/** Split an objective into coarse pending requirements (heuristic manager). */
export function initTaskState(objective: string): TaskState {
  const trimmed = objective.trim();
  const chunks = trimmed
    .split(/(?:^|\n)\s*(?:\d+[.)]\s+|[-*]\s+)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8);

  const requirementTexts =
    chunks.length >= 2
      ? chunks.slice(0, 8)
      : [
          trimmed.slice(0, 500),
          "Hard gates pass: build, tests, lint, and no verification tampering.",
          "Changes are committed and reviewable (focused diff, clear commit message).",
        ];

  return {
    objective: trimmed,
    requirements: requirementTexts.map((text, i) => ({
      id: `req_${i + 1}`,
      text,
      status: "pending" as const,
      evidenceRefs: [],
    })),
    artifacts: [],
    facts: [],
    round: 0,
  };
}

/**
 * Apply an audit report. Executor claims never call this — only auditor
 * output. Completed marks require integrity=clean.
 */
export function applyAudit(state: TaskState, audit: AuditReport): TaskState {
  const completed = new Set(audit.integrity === "clean" ? audit.completedRequirementIds : []);
  const unmet = new Set(audit.unmetRequirementIds);
  const blocked = audit.completion === "blocked";

  const requirements = state.requirements.map((r) => {
    if (completed.has(r.id)) {
      return {
        ...r,
        status: "completed" as const,
        evidenceRefs: [...r.evidenceRefs, ...audit.facts.map((f) => f.evidenceRef)].slice(0, 8),
      };
    }
    if (audit.integrity === "violation") {
      return { ...r, status: "untrusted" as const };
    }
    if (blocked && unmet.has(r.id)) {
      return { ...r, status: "blocked" as const };
    }
    if (unmet.has(r.id) && r.status === "completed") {
      // Auditor contradicts a prior completion — demote.
      return { ...r, status: "untrusted" as const };
    }
    return r;
  });

  const newFacts: TaskFact[] = audit.facts.map((f, i) => ({
    id: `fact_${state.round}_${i + 1}`,
    text: f.text,
    status: audit.integrity === "violation" ? ("untrusted" as const) : ("completed" as const),
    evidenceRefs: [f.evidenceRef],
  }));

  return {
    ...state,
    requirements,
    facts: [...state.facts, ...newFacts].slice(-40),
    round: state.round + 1,
  };
}

/**
 * Overnight/sandbox auditor: a commit landed, every declared check passed,
 * and nothing that grades the work was touched. `checks` come from the repo's
 * proof contract (`proof.ts`); `tampering` lists files whose change would let
 * the run grade its own homework. The legacy `testExitCode` stays honoured
 * for callers that still probe a bare `npm test`.
 */
export function auditFromSandboxProbe(input: {
  state: TaskState;
  contractTargets: string[];
  hasNewCommit: boolean;
  headSha: string | null;
  testExitCode: number | null;
  checks?: ReadonlyArray<{ name: string; pass: boolean; exitCode: number | null }>;
  tampering?: readonly string[];
}): AuditReport {
  const facts: AuditReport["facts"] = [];
  if (input.headSha) {
    facts.push({
      text: `HEAD=${input.headSha.slice(0, 12)}; newCommit=${input.hasNewCommit}`,
      evidenceRef: "git_head",
    });
  }
  if (input.testExitCode != null) {
    facts.push({
      text: `test_exit=${input.testExitCode}`,
      evidenceRef: "tests",
    });
  }
  const checks = input.checks ?? [];
  for (const c of checks) {
    facts.push({
      text: `check ${c.name}: ${c.pass ? "pass" : `fail (exit ${c.exitCode ?? "timeout"})`}`,
      evidenceRef: `check:${c.name}`,
    });
  }
  const tampering = input.tampering ?? [];
  if (tampering.length > 0) {
    facts.push({
      text: `Verification tampering: ${tampering.slice(0, 5).join(", ")}`,
      evidenceRef: "verification_tampering",
    });
  }

  const integrity: AuditIntegrity = tampering.length > 0 ? "violation" : "clean";
  const testsOk = input.testExitCode == null || input.testExitCode === 0;
  const failedChecks = checks.filter((c) => !c.pass).map((c) => c.name);
  const checksOk = failedChecks.length === 0;
  const passes = input.hasNewCommit && testsOk && checksOk && integrity === "clean";

  const completedRequirementIds: string[] = [];
  const unmetRequirementIds: string[] = [];
  const gaps: string[] = [];

  for (const id of input.contractTargets) {
    if (passes) completedRequirementIds.push(id);
    else {
      unmetRequirementIds.push(id);
      if (!input.hasNewCommit) gaps.push("No new commit this round.");
      if (!testsOk) gaps.push(`Tests failed (exit ${input.testExitCode}).`);
      if (!checksOk) gaps.push(`Checks failed: ${failedChecks.join(", ")}.`);
      if (integrity !== "clean") gaps.push("Verification files were modified or deleted.");
    }
  }

  // Also advance matching heuristic requirements when commit+checks hold.
  if (passes) {
    for (const r of input.state.requirements) {
      if (r.status === "pending" && /commit|hard gates|build|tests/i.test(r.text)) {
        completedRequirementIds.push(r.id);
      }
    }
  }

  const completion: AuditCompletion =
    integrity === "violation"
      ? "blocked"
      : completedRequirementIds.length > 0 && unmetRequirementIds.length === 0
        ? "complete"
        : "incomplete";

  const passedNames = checks.filter((c) => c.pass).map((c) => c.name);
  return {
    completion,
    integrity,
    completedRequirementIds: [...new Set(completedRequirementIds)],
    unmetRequirementIds: [...new Set(unmetRequirementIds)],
    facts,
    gaps: [...new Set(gaps)],
    summary:
      completion === "complete"
        ? passedNames.length > 0
          ? `Sandbox audit: commit verified; ${passedNames.join(", ")} passed.`
          : "Sandbox audit: commit verified; tests clean."
        : `Sandbox audit incomplete: ${[...new Set(gaps)].join(" ") || "criteria unmet"}`,
  };
}
