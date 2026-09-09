import { describe, expect, it } from "vitest";
import { applyAudit, auditFromSandboxProbe, initTaskState } from "../src/mea.js";

function target() {
  const state = initTaskState("One step");
  return { state, targets: state.requirements.map((r) => r.id) };
}

describe("task state", () => {
  it("init marks every requirement pending", () => {
    const state = initTaskState("Fix the flaky auth test and keep CI green.");
    expect(state.requirements.length).toBeGreaterThanOrEqual(2);
    expect(state.requirements.every((r) => r.status === "pending")).toBe(true);
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

    const clean = applyAudit(state, {
      completion: "complete",
      integrity: "clean",
      completedRequirementIds: state.requirements.map((r) => r.id),
      unmetRequirementIds: [],
      facts: [{ text: "gates ok", evidenceRef: "hard_gates" }],
      gaps: [],
      summary: "ok",
    });
    expect(clean.requirements.every((r) => r.status === "completed")).toBe(true);
    expect(clean.round).toBe(1);
  });
});

describe("auditFromSandboxProbe", () => {
  it("does not complete while the workspace is unchanged", () => {
    const { state, targets } = target();
    const audit = auditFromSandboxProbe({
      state,
      contractTargets: targets,
      hasNewCommit: false,
      headSha: "abc123",
      testExitCode: null,
    });
    expect(audit.completion).toBe("incomplete");
    expect(audit.unmetRequirementIds).toEqual(targets);
    expect(audit.gaps).toContain("No new commit this round.");
  });

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

  it("completes and names the checks when the workspace changed and every check passed", () => {
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

  it("marks the round a violation when verification files were deleted", () => {
    const { state, targets } = target();
    const audit = auditFromSandboxProbe({
      state,
      contractTargets: targets,
      hasNewCommit: true,
      headSha: "abc1234",
      testExitCode: null,
      checks: [{ name: "test", pass: true, exitCode: 0 }],
      tampering: ["src/__tests__/billing.test.ts"],
    });
    expect(audit.completion).toBe("blocked");
    expect(audit.integrity).toBe("violation");
    const next = applyAudit(state, audit);
    expect(next.requirements.every((r) => r.status === "untrusted")).toBe(true);
  });
});
