/**
 * Manage–Execute–Audit (MEA) primitives from LongHorizon-Harness
 * (arXiv:2608.01964).
 *
 * Long-horizon reliability is a task-state management problem: keep state
 * outside the executor, advance it only with environment-verified facts, and
 * give each round a bounded subtask contract. Dream Mode already has
 * ledger/verify/clean-room; this module is the shared contract + state
 * shape those loops should speak.
 *
 * Roles (not new runtimes — adapters over OpenCode / relay verify):
 *   Manager  — owns TaskState, emits SubtaskContract or done/blocked
 *   Executor — fresh-context turn; claims do not update TaskState
 *   Auditor  — read-only / outside-worker evidence → AuditReport
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

export type SubtaskContract = {
  goal: string;
  acceptanceCriteria: string[];
  /** Hard limits the executor must not cross. */
  constraints: string[];
  /** Compact audited context — never raw prior trajectories. */
  priorEvidence: string[];
  /** Which requirement ids this contract is meant to advance. */
  targets: string[];
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

export type ManagerDecision =
  | { kind: "execute"; contract: SubtaskContract; state: TaskState }
  | { kind: "done"; state: TaskState }
  | { kind: "blocked"; state: TaskState; reason: string };

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

export function pendingRequirements(state: TaskState): TaskRequirement[] {
  return state.requirements.filter((r) => r.status === "pending" || r.status === "untrusted");
}

export function taskStateSatisfied(state: TaskState): boolean {
  return (
    state.requirements.length > 0 &&
    state.requirements.every((r) => r.status === "completed") &&
    !state.requirements.some((r) => r.status === "untrusted")
  );
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

/** Manager: pick one pending requirement and build a bounded contract. */
export function manageNext(
  state: TaskState,
  opts?: {
    constraints?: string[];
    maxEvidence?: number;
  },
): ManagerDecision {
  if (taskStateSatisfied(state)) {
    return { kind: "done", state };
  }

  const pending = pendingRequirements(state);
  if (pending.length === 0) {
    const blocked = state.requirements.filter((r) => r.status === "blocked");
    if (blocked.length > 0) {
      return {
        kind: "blocked",
        state,
        reason: `Blocked requirements: ${blocked.map((r) => r.id).join(", ")}`,
      };
    }
    return { kind: "blocked", state, reason: "No pending requirements remain." };
  }

  const target = pending[0]!;
  const evidenceLimit = opts?.maxEvidence ?? 8;
  const priorEvidence = [
    ...state.facts
      .filter((f) => f.status === "completed")
      .slice(-evidenceLimit)
      .map((f) => f.text),
    ...state.requirements.filter((r) => r.status === "completed").map((r) => `Done: ${r.text}`),
  ].slice(0, evidenceLimit);

  const gaps = pending.slice(1, 4).map((r) => r.text);

  const contract: SubtaskContract = {
    goal: target.text,
    acceptanceCriteria: [
      `Environment evidence shows: ${target.text}`,
      "Do not mark the overall objective complete — only this subtask.",
      "Commit focused changes when done.",
    ],
    constraints: [
      "Work autonomously; do not ask for confirmation.",
      "Do not weaken or delete tests/verification to pass gates.",
      ...(opts?.constraints ?? []),
    ],
    priorEvidence: [
      ...priorEvidence,
      ...(gaps.length ? [`Still pending after this subtask: ${gaps.join("; ")}`] : []),
    ],
    targets: [target.id],
  };

  return { kind: "execute", contract, state };
}

/** Build a first-round contract covering the whole objective (Dream spawn). */
export function initialContract(objective: string, priorEvidence: string[] = []): SubtaskContract {
  const state = initTaskState(objective);
  const decision = manageNext(state, {
    constraints: [],
    maxEvidence: 6,
  });
  if (decision.kind === "execute") {
    return {
      ...decision.contract,
      goal: objective.trim().slice(0, 800),
      acceptanceCriteria: [
        ...state.requirements.slice(0, 4).map((r) => r.text),
        "Build/tests/lint pass; no verification tampering.",
      ],
      priorEvidence: [...priorEvidence, ...decision.contract.priorEvidence].slice(0, 8),
      targets: state.requirements.map((r) => r.id),
    };
  }
  return {
    goal: objective.trim().slice(0, 800),
    acceptanceCriteria: [
      "Hard gates pass: build, tests, lint, no verification tampering.",
      "Changes committed and reviewable.",
    ],
    constraints: ["Work autonomously; do not ask for confirmation."],
    priorEvidence,
    targets: ["req_1"],
  };
}

export function formatContractPrompt(
  contract: SubtaskContract,
  opts?: {
    header?: string;
    objective?: string;
  },
): string {
  const lines = [
    opts?.header ?? "# Subtask contract (Manage–Execute–Audit)",
    "",
    ...(opts?.objective ? ["## Overall objective", opts.objective.slice(0, 800), ""] : []),
    "## Immediate goal",
    contract.goal,
    "",
    "## Acceptance criteria (auditor will check these — not your self-report)",
    ...contract.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`),
    "",
    "## Constraints",
    ...contract.constraints.map((c) => `- ${c}`),
  ];
  if (contract.priorEvidence.length > 0) {
    lines.push("", "## Verified prior evidence (only source of cross-round memory)");
    for (const e of contract.priorEvidence) {
      lines.push(`- ${e}`);
    }
  }
  lines.push(
    "",
    "## Instructions",
    "Execute only this contract. Leave a clear commit when done.",
    "Do not invent completion — the auditor inspects the environment next.",
  );
  return lines.join("\n");
}

export function formatTaskState(state: TaskState): string {
  const fmt = (status: RecordStatus, text: string) => `- [${status}] ${text}`;
  return [
    `Objective: ${state.objective.slice(0, 400)}`,
    `Round: ${state.round}`,
    "Requirements:",
    ...state.requirements.map((r) => fmt(r.status, `${r.id}: ${r.text}`)),
    "Facts:",
    ...(state.facts.length
      ? state.facts.slice(-12).map((f) => fmt(f.status, f.text))
      : ["- (none)"]),
  ].join("\n");
}

/**
 * Deterministic auditor from Dream hard-gate / diff evidence.
 * No model call — integrity comes from outside-worker verify.
 */
export function auditFromHardGates(input: {
  state: TaskState;
  hardGate: {
    build: { pass: boolean };
    tests: { pass: boolean };
    lint: { pass: boolean };
    securityScan: { pass: boolean };
    verificationTampering: { pass: boolean };
  };
  diffStat: {
    filesChanged?: number;
    insertions?: number;
    deletions?: number;
  };
  contractTargets?: string[];
}): AuditReport {
  const { hardGate, diffStat, state } = input;
  const gates = [
    ["build", hardGate.build.pass],
    ["tests", hardGate.tests.pass],
    ["lint", hardGate.lint.pass],
    ["security", hardGate.securityScan.pass],
  ] as const;

  const integrity: AuditIntegrity = hardGate.verificationTampering.pass ? "clean" : "violation";

  const failedGates = gates.filter(([, pass]) => !pass).map(([name]) => name);
  const allGatesPass = failedGates.length === 0 && integrity === "clean";
  const hasDiff = (diffStat.filesChanged ?? 0) > 0;

  const facts: AuditReport["facts"] = [
    {
      text: `Hard gates: build=${hardGate.build.pass} tests=${hardGate.tests.pass} lint=${hardGate.lint.pass} security=${hardGate.securityScan.pass}`,
      evidenceRef: "hard_gates",
    },
    {
      text: `Diff: ${diffStat.filesChanged ?? 0} files, +${diffStat.insertions ?? 0}/-${diffStat.deletions ?? 0}`,
      evidenceRef: "diff_stat",
    },
  ];
  if (!hardGate.verificationTampering.pass) {
    facts.push({
      text: "Verification tampering detected — task-state records marked untrusted.",
      evidenceRef: "verification_tampering",
    });
  }

  const targets =
    input.contractTargets?.filter((id) => state.requirements.some((r) => r.id === id)) ??
    state.requirements.map((r) => r.id);

  const gateReq = state.requirements.find((r) => /hard gates|build|tests|lint/i.test(r.text));
  const commitReq = state.requirements.find((r) => /commit|reviewable|diff/i.test(r.text));

  const completedRequirementIds: string[] = [];
  const unmetRequirementIds: string[] = [];
  const gaps: string[] = [];

  if (allGatesPass && gateReq) completedRequirementIds.push(gateReq.id);
  else if (gateReq) {
    unmetRequirementIds.push(gateReq.id);
    gaps.push(`Failed gates: ${failedGates.join(", ") || "tampering"}`);
  }

  if (hasDiff && commitReq) completedRequirementIds.push(commitReq.id);
  else if (commitReq) {
    unmetRequirementIds.push(commitReq.id);
    gaps.push("No committed diff observed.");
  }

  // Primary objective requirement: only complete when gates + diff both hold.
  const primary = state.requirements[0];
  if (primary && !completedRequirementIds.includes(primary.id)) {
    if (allGatesPass && hasDiff) completedRequirementIds.push(primary.id);
    else {
      unmetRequirementIds.push(primary.id);
      if (!allGatesPass) gaps.push("Primary objective unmet until hard gates pass.");
      if (!hasDiff) gaps.push("Primary objective unmet until a committed change exists.");
    }
  }

  for (const id of targets) {
    if (
      !completedRequirementIds.includes(id) &&
      !unmetRequirementIds.includes(id) &&
      state.requirements.some((r) => r.id === id && r.status !== "completed")
    ) {
      if (allGatesPass && hasDiff) completedRequirementIds.push(id);
      else unmetRequirementIds.push(id);
    }
  }

  const completion: AuditCompletion =
    integrity === "violation"
      ? "blocked"
      : unmetRequirementIds.length === 0 && completedRequirementIds.length > 0
        ? "complete"
        : failedGates.length > 0
          ? "incomplete"
          : hasDiff
            ? "incomplete"
            : "incomplete";

  return {
    completion,
    integrity,
    completedRequirementIds: [...new Set(completedRequirementIds)],
    unmetRequirementIds: [...new Set(unmetRequirementIds)],
    facts,
    gaps,
    summary:
      completion === "complete"
        ? "Auditor: contract satisfied by environment evidence."
        : `Auditor: ${completion}; gaps: ${gaps.slice(0, 3).join("; ") || "see unmet requirements"}`,
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

export function parseTaskStateJson(raw: string): TaskState | null {
  try {
    const v = JSON.parse(raw) as TaskState;
    if (!v || typeof v.objective !== "string" || !Array.isArray(v.requirements)) {
      return null;
    }
    return v;
  } catch {
    return null;
  }
}
