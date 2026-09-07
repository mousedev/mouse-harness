import { describe, expect, it } from "vitest";
import {
  applyAudit,
  auditFromHardGates,
  auditFromSandboxProbe,
  formatContractPrompt,
  initialContract,
  initTaskState,
  manageNext,
  taskStateSatisfied,
} from "../src/mea.js";

describe("MEA task state", () => {
  it("init marks requirements pending and manageNext emits a contract", () => {
    const state = initTaskState("Fix the flaky auth test and keep CI green.");
    expect(state.requirements.length).toBeGreaterThanOrEqual(2);
    expect(state.requirements.every((r) => r.status === "pending")).toBe(true);

    const decision = manageNext(state);
    expect(decision.kind).toBe("execute");
    if (decision.kind !== "execute") return;
    expect(decision.contract.acceptanceCriteria.length).toBeGreaterThan(0);
    expect(decision.contract.targets.length).toBe(1);
  });

  it("only clean audits mark requirements completed", () => {
    const state = initTaskState("Ship a focused fix.");
    const dirty = applyAudit(state, {
      completion: "incomplete",
      integrity: "violation",
      completedRequirementIds: [state.requirements[0]!.id],
      unmetRequirementIds: [],
      facts: [{ text: "tampered", evidenceRef: "x" }],
      gaps: [],
      summary: "violation",
    });
    expect(dirty.requirements[0]!.status).toBe("untrusted");
    expect(taskStateSatisfied(dirty)).toBe(false);

    const clean = applyAudit(state, {
      completion: "complete",
      integrity: "clean",
      completedRequirementIds: state.requirements.map((r) => r.id),
      unmetRequirementIds: [],
      facts: [{ text: "gates ok", evidenceRef: "hard_gates" }],
      gaps: [],
      summary: "ok",
    });
    expect(taskStateSatisfied(clean)).toBe(true);
    expect(manageNext(clean).kind).toBe("done");
  });

  it("auditFromHardGates refuses completion without diff or gates", () => {
    const state = initTaskState("Implement feature X");
    const audit = auditFromHardGates({
      state,
      hardGate: {
        build: { pass: true },
        tests: { pass: false },
        lint: { pass: true },
        securityScan: { pass: true },
        verificationTampering: { pass: true },
      },
      diffStat: { filesChanged: 2, insertions: 10, deletions: 1 },
    });
    expect(audit.completion).toBe("incomplete");
    expect(audit.gaps.some((g) => /Failed gates/i.test(g))).toBe(true);
  });

  it("auditFromHardGates completes when gates+diff hold", () => {
    const state = initTaskState("Implement feature X");
    const audit = auditFromHardGates({
      state,
      hardGate: {
        build: { pass: true },
        tests: { pass: true },
        lint: { pass: true },
        securityScan: { pass: true },
        verificationTampering: { pass: true },
      },
      diffStat: { filesChanged: 3, insertions: 40, deletions: 2 },
    });
    const next = applyAudit(state, audit);
    expect(audit.integrity).toBe("clean");
    expect(
      taskStateSatisfied(next) || next.requirements.some((r) => r.status === "completed"),
    ).toBe(true);
  });

  it("sandbox probe does not complete without a new commit", () => {
    const state = initTaskState("One step");
    const decision = manageNext(state);
    expect(decision.kind).toBe("execute");
    if (decision.kind !== "execute") return;
    const audit = auditFromSandboxProbe({
      state,
      contractTargets: decision.contract.targets,
      hasNewCommit: false,
      headSha: "abc123",
      testExitCode: 0,
    });
    expect(audit.completion).toBe("incomplete");
    expect(audit.unmetRequirementIds).toEqual(decision.contract.targets);
  });

  it("formatContractPrompt keeps acceptance criteria visible", () => {
    const c = initialContract("Refactor the billing module");
    const prompt = formatContractPrompt(c, { objective: "Refactor the billing module" });
    expect(prompt).toMatch(/Acceptance criteria/);
    expect(prompt).toMatch(/auditor will check/i);
    expect(prompt).not.toMatch(/You are done/);
  });
});

describe("auditFromSandboxProbe with a proof contract", () => {
  function target() {
    const state = initTaskState("One step");
    const decision = manageNext(state);
    if (decision.kind !== "execute") throw new Error("expected execute");
    return { state, targets: decision.contract.targets };
  }

  it("refuses completion when any declared check fails", () => {
    const { state, targets } = target();
    const audit = auditFromSandboxProbe({
      state,
      contractTargets: targets,
      hasNewCommit: true,
      headSha: "abc1234",
      testExitCode: null,
      checks: [
        { name: "build", pass: true, exitCode: 0 },
        { name: "test", pass: false, exitCode: 1 },
      ],
    });
    expect(audit.completion).toBe("incomplete");
    expect(audit.integrity).toBe("clean");
    expect(audit.gaps).toContain("Checks failed: test.");
    expect(audit.facts.map((f) => f.evidenceRef)).toContain("check:test");
  });

  it("completes and names the checks when commit + every check hold", () => {
    const { state, targets } = target();
    const audit = auditFromSandboxProbe({
      state,
      contractTargets: targets,
      hasNewCommit: true,
      headSha: "abc1234",
      testExitCode: null,
      checks: [
        { name: "build", pass: true, exitCode: 0 },
        { name: "test", pass: true, exitCode: 0 },
      ],
    });
    expect(audit.completion).toBe("complete");
    expect(audit.summary).toBe("Sandbox audit: commit verified; build, test passed.");
    expect(applyAudit(state, audit).requirements[0]!.status).toBe("completed");
  });

  it("marks the round a violation when verification files were touched", () => {
    const { state, targets } = target();
    const audit = auditFromSandboxProbe({
      state,
      contractTargets: targets,
      hasNewCommit: true,
      headSha: "abc1234",
      testExitCode: null,
      checks: [{ name: "test", pass: true, exitCode: 0 }],
      tampering: ["D:src/__tests__/billing.test.ts"],
    });
    expect(audit.completion).toBe("blocked");
    expect(audit.integrity).toBe("violation");
    const next = applyAudit(state, audit);
    expect(next.requirements.every((r) => r.status === "untrusted")).toBe(true);
    expect(taskStateSatisfied(next)).toBe(false);
  });
});
