import { describe, expect, it } from "vitest";
import type { LoopEvent } from "../src/events.js";
import {
  AUDIT_CLOSE,
  AUDIT_OPEN,
  buildContinuePrompt,
  type CheckResult,
  type CompletionProbe,
  MIN_ROUND_MS,
  parseAuditBlock,
  runCompletionLoop,
} from "../src/loop.js";
import { initTaskState } from "../src/mea.js";

const INSTRUCTION = `Add a \`data\` keyword to State.

- On entry, data initializes from the defaults.
- get_state_data(state) returns the active dict.
- Data survives pickle.`;

function check(name: string, pass: boolean): CheckResult {
  return {
    name,
    command: `${name} cmd`,
    pass,
    exitCode: pass ? 0 : 1,
    excerpt: pass ? "ok" : "FAILED tests/test_x.py::test_y - assert 1 == 2",
  };
}

const doneAudit = `Summary.\n${AUDIT_OPEN}\n- [done] data keyword: state.py:12, test_data.py green\n- [done] pickle: test_pickle.py\n${AUDIT_CLOSE}`;
const todoAudit = `${AUDIT_OPEN}\n- [done] data keyword: state.py\n- [todo] pickle: not implemented\n${AUDIT_CLOSE}`;

function world(opts: {
  fingerprint: string;
  checks: CheckResult[];
  text: string;
  tampering?: string[];
}) {
  const state = { ...opts, tampering: opts.tampering ?? [] };
  const probe: CompletionProbe = {
    checks: async () => state.checks,
    tampering: async () => state.tampering,
    fingerprint: async () => state.fingerprint,
  };
  return { state, probe };
}

type Input = Parameters<typeof runCompletionLoop>[0];

function loopInput(
  probe: CompletionProbe,
  onPrompt: (prompt: string, model: string | undefined) => Promise<void>,
  text: () => string,
  extra: Partial<Input> = {},
) {
  const events: LoopEvent[] = [];
  let steps = 1;
  const input: Input = {
    probe,
    engine: {
      prompt: async (_session, prompt, _signal, opts) => {
        steps += 1;
        await onPrompt(prompt, opts?.model);
        return { steps: 1, text: text() };
      },
    },
    sessionId: "s1",
    model: "m",
    signal: new AbortController().signal,
    instruction: INSTRUCTION,
    onEvent: (e) => {
      events.push(e);
    },
    budget: { maxWallMs: 3_600_000, maxTotalSteps: 600, maxNonProgressRounds: 3 },
    startedAt: 0,
    initialFingerprint: "",
    steps: () => steps,
    lastAssistantText: text,
    now: () => 1_000,
    ...extra,
  };
  return { input, events };
}

describe("parseAuditBlock", () => {
  it("reads done/todo lines and accepts checkbox spellings", () => {
    const a = parseAuditBlock(
      `${AUDIT_OPEN}\n- [done] a: x\n- [x] b: y\n- [todo] c: z\n- [ ] d\n${AUDIT_CLOSE}`,
    );
    expect(a).toEqual({ done: ["a: x", "b: y"], todo: ["c: z", "d"] });
  });

  it("uses the last block and returns null without one", () => {
    expect(parseAuditBlock("no audit here")).toBeNull();
    const a = parseAuditBlock(`${todoAudit}\n\nlater\n${doneAudit}`);
    expect(a?.todo).toEqual([]);
    expect(a?.done).toHaveLength(2);
  });
});

describe("buildContinuePrompt", () => {
  it("carries the failing check output, the requirements, and the audit format", () => {
    const p = buildContinuePrompt("fix", {
      instruction: INSTRUCTION,
      state: initTaskState(INSTRUCTION),
      failed: [check("pytest", false)],
      audit: null,
    });
    expect(p).toContain("Verification failed");
    expect(p).toContain("assert 1 == 2");
    expect(p).toContain("Never weaken, skip, or delete tests");
    expect(p).toContain("get_state_data(state) returns the active dict.");
    expect(p).toContain(AUDIT_OPEN);
    expect(p).toContain(AUDIT_CLOSE);
  });

  it("repeats the model's own todo items on an audit round", () => {
    const p = buildContinuePrompt("audit", {
      instruction: INSTRUCTION,
      state: initTaskState(INSTRUCTION),
      failed: [],
      audit: { done: [], todo: ["pickle: not implemented"] },
    });
    expect(p).toContain("You previously listed these as not done");
    expect(p).toContain("pickle: not implemented");
  });
});

describe("runCompletionLoop", () => {
  it("red suite -> fix round -> green + audit -> satisfied", async () => {
    const w = world({ fingerprint: "edited-1", checks: [check("pytest", false)], text: "done!" });
    const prompts: string[] = [];
    const { input, events } = loopInput(
      w.probe,
      async (p) => {
        prompts.push(p);
        if (prompts.length === 1) {
          w.state.fingerprint = "edited-2";
          w.state.checks = [check("pytest", true)];
          w.state.text = "fixed";
        } else {
          w.state.text = doneAudit;
        }
      },
      () => w.state.text,
    );
    const r = await runCompletionLoop(input);
    expect(r.outcome).toBe("satisfied");
    expect(r.rounds.map((x) => x.kind)).toEqual(["fix", "audit"]);
    expect(prompts[0]).toContain("Verification failed");
    expect(prompts[1]).toContain("Before finishing, verify the task is complete");
    expect(events.filter((e) => e.type === "check_status")).toHaveLength(3);
    expect(r.totalSteps).toBe(3);
  });

  it("a turn that changed nothing gets a nochange round and never runs the suite", async () => {
    let suiteRuns = 0;
    const w = world({ fingerprint: "", checks: [], text: "I would do X" });
    w.probe.checks = async () => {
      suiteRuns += 1;
      return w.state.checks;
    };
    const kinds: string[] = [];
    const { input } = loopInput(
      w.probe,
      async (p) => {
        kinds.push(p.split("\n")[0]!);
        w.state.fingerprint = "edited";
        w.state.text = doneAudit;
      },
      () => w.state.text,
    );
    const r = await runCompletionLoop(input);
    expect(r.outcome).toBe("satisfied");
    expect(r.rounds[0]?.kind).toBe("nochange");
    expect(kinds[0]).toMatch(/No files in the workspace have changed/);
    expect(suiteRuns).toBe(1);
  });

  it("stops as stalled after consecutive rounds with no workspace change", async () => {
    const w = world({ fingerprint: "edited", checks: [check("pytest", false)], text: "hmm" });
    let calls = 0;
    const { input } = loopInput(
      w.probe,
      async () => {
        calls += 1;
      },
      () => w.state.text,
    );
    const r = await runCompletionLoop(input);
    expect(r.outcome).toBe("stalled");
    expect(calls).toBe(3);
    expect(r.rounds.every((x) => !x.progressed)).toBe(true);
  });

  it("escalates the model after two non-progress rounds when a ladder exists", async () => {
    const w = world({ fingerprint: "edited", checks: [check("pytest", false)], text: "" });
    const models: Array<string | undefined> = [];
    const { input } = loopInput(
      w.probe,
      async (_p, model) => {
        models.push(model);
        if (model === "big") {
          w.state.fingerprint = "edited-2";
          w.state.checks = [check("pytest", true)];
          w.state.text = doneAudit;
        }
      },
      () => w.state.text,
      { escalate: async () => "big" },
    );
    const r = await runCompletionLoop(input);
    expect(r.outcome).toBe("satisfied");
    expect(models).toEqual(["m", "m", "big"]);
    expect(r.rounds.at(-1)?.model).toBe("big");
  });

  it("respects the wall clock and does not start a round it cannot finish", async () => {
    const w = world({ fingerprint: "edited", checks: [check("pytest", false)], text: "" });
    let calls = 0;
    const { input } = loopInput(
      w.probe,
      async () => {
        calls += 1;
      },
      () => w.state.text,
      { budget: { maxWallMs: MIN_ROUND_MS + 500, maxTotalSteps: 600, maxNonProgressRounds: 3 } },
    );
    const r = await runCompletionLoop(input);
    expect(r.outcome).toBe("wall_clock");
    expect(calls).toBe(0);
  });

  it("stops on the step ceiling", async () => {
    const w = world({ fingerprint: "edited", checks: [check("pytest", false)], text: "" });
    const { input } = loopInput(
      w.probe,
      async () => {},
      () => w.state.text,
      { steps: () => 600 },
    );
    expect((await runCompletionLoop(input)).outcome).toBe("step_budget");
  });

  it("blocks when verification files were deleted", async () => {
    const w = world({
      fingerprint: "edited",
      checks: [check("pytest", true)],
      text: doneAudit,
      tampering: ["tests/test_data.py"],
    });
    const { input, events } = loopInput(
      w.probe,
      async () => {},
      () => w.state.text,
    );
    const r = await runCompletionLoop(input);
    expect(r.outcome).toBe("blocked");
    expect(events.some((e) => e.type === "notice" && /were deleted/.test(e.message))).toBe(true);
  });

  it("an audit round that edits nothing but reports everything done is satisfied, not stalled", async () => {
    const w = world({ fingerprint: "edited", checks: [check("pytest", true)], text: "all good" });
    const { input } = loopInput(
      w.probe,
      async () => {
        w.state.text = doneAudit;
      },
      () => w.state.text,
    );
    const r = await runCompletionLoop(input);
    expect(r.outcome).toBe("satisfied");
    expect(r.rounds).toHaveLength(1);
    expect(r.rounds[0]?.progressed).toBe(false);
  });

  it("keeps working while the model itself reports todo items", async () => {
    const w = world({ fingerprint: "e1", checks: [], text: todoAudit });
    let n = 0;
    const { input } = loopInput(
      w.probe,
      async () => {
        n += 1;
        w.state.fingerprint = `e${n + 1}`;
        w.state.text = n >= 2 ? doneAudit : todoAudit;
      },
      () => w.state.text,
    );
    const r = await runCompletionLoop(input);
    expect(r.outcome).toBe("satisfied");
    expect(n).toBe(2);
  });

  it("returns aborted when the engine throws AbortError", async () => {
    const w = world({ fingerprint: "edited", checks: [check("pytest", false)], text: "" });
    const { input } = loopInput(
      w.probe,
      async () => {
        throw Object.assign(new Error("Aborted"), { name: "AbortError" });
      },
      () => w.state.text,
    );
    expect((await runCompletionLoop(input)).outcome).toBe("aborted");
  });
});
