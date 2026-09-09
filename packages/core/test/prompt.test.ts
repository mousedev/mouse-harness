import { describe, expect, it } from "vitest";
import { AGENT_PROMPT_MAX_CHARS, buildAgentPrompt } from "../src/prompt.js";

describe("buildAgentPrompt", () => {
  it("stays under the token budget", () => {
    const p = buildAgentPrompt("build", { profile: "bench" });
    expect(p).toBeDefined();
    expect(p!.length).toBeLessThanOrEqual(AGENT_PROMPT_MAX_CHARS);
  });

  // The prompt asks for two things the loop then verifies: keep working until
  // the task is done, and run the tests before saying so.
  it("carries persistence and verification, not diff minimality", () => {
    const p = buildAgentPrompt("build")!;
    expect(p).toMatch(/Persist until the task is fully handled/);
    expect(p).toMatch(/Only stop when you are sure/);
    expect(p).toMatch(/full suite before finishing/);
    expect(p).toMatch(/Never weaken, skip, or delete tests/);
    expect(p).not.toMatch(/MINIMAL/);
    expect(p).not.toMatch(/shortest working diff/i);
  });

  it("keeps the engine default for the read-only modes and unknown modes", () => {
    expect(buildAgentPrompt("ask")).toBeUndefined();
    expect(buildAgentPrompt("plan")).toBeUndefined();
    expect(buildAgentPrompt("debug")).toBeUndefined();
    expect(buildAgentPrompt("dream")).toBeUndefined();
    expect(buildAgentPrompt("overnight")).toBe(buildAgentPrompt("build"));
  });
});
