import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mouseHome, runsDir, traceFile, workspaceSlug } from "../src/paths.js";
import { openTrace, parseTrace } from "../src/trace.js";

describe("paths", () => {
  it("never points inside the workspace", () => {
    const env = { MOUSE_HOME: "/home/x/.mouse" };
    expect(mouseHome(env)).toBe("/home/x/.mouse");
    expect(workspaceSlug("/Users/me/repo")).toBe("--Users-me-repo--");
    expect(runsDir("/Users/me/repo", env)).toBe("/home/x/.mouse/runs/--Users-me-repo--");
    expect(traceFile("/Users/me/repo", env)).toMatch(
      /\/home\/x\/\.mouse\/runs\/--Users-me-repo--\/.+\.jsonl$/,
    );
  });
});

describe("trace", () => {
  it("appends versioned JSONL records and parses them back", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mouse-trace-"));
    try {
      const t = openTrace(path.join(dir, "nested", "run.jsonl"));
      t.write({
        type: "mouse.start",
        v: 1,
        version: "0.1.0",
        model: "m",
        workspace: "/w",
        profile: "local",
        runStartSha: null,
        maxWallSec: 1,
      });
      t.write({ type: "mouse.error", error: "x", steps: 0, elapsedMs: 1 });
      const records = parseTrace(`${readFileSync(t.file, "utf8")}\nnot json\n`);
      expect(records.map((r) => r.type)).toEqual(["mouse.start", "mouse.error"]);
      expect(records[0]?.v).toBe(1);
      expect(typeof records[0]?.ts).toBe("number");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
