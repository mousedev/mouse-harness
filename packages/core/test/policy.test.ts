import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, loadPolicy, parsePolicy, permissionRulesForTool } from "../src/policy.js";
import type { Workspace } from "../src/workspace.js";

describe("parsePolicy", () => {
  it("returns defaults for an empty or malformed document", () => {
    expect(parsePolicy({})).toEqual(DEFAULT_POLICY);
    expect(parsePolicy(null)).toEqual(DEFAULT_POLICY);
    expect(parsePolicy("nope")).toEqual(DEFAULT_POLICY);
    expect(parsePolicy({ loop: { maxWallSec: "long", maxSteps: -1 } }).loop).toEqual(
      DEFAULT_POLICY.loop,
    );
  });

  it("reads every documented block and keeps unknown keys", () => {
    const p = parsePolicy({
      verify: { checks: [{ name: "test", command: "pnpm test" }], timeoutSec: 120 },
      loop: { maxWallSec: 3600, nonProgressRounds: 5 },
      context: { prune: { enabled: true, thresholdChars: 4000 } },
      permissions: { bash: { "git push*": "deny", "*": "allow" }, doom_loop: "ask", edit: "bogus" },
      autonomy: { enabled: true },
    });
    expect(p.verify).toEqual({ checks: [{ name: "test", command: "pnpm test" }], timeoutSec: 120 });
    expect(p.loop).toEqual({ ...DEFAULT_POLICY.loop, maxWallSec: 3600, nonProgressRounds: 5 });
    expect(p.context.prune).toEqual({
      ...DEFAULT_POLICY.context.prune,
      enabled: true,
      thresholdChars: 4000,
    });
    expect(p.permissions).toEqual({
      bash: { "git push*": "deny", "*": "allow" },
      doom_loop: "ask",
    });
    expect(p.extra).toEqual({ autonomy: { enabled: true } });
  });

  it("accepts the object form of checks and an empty list to mean 'no checks'", () => {
    expect(parsePolicy({ verify: { checks: { test: "pytest", lint: "" } } }).verify.checks).toEqual(
      [{ name: "test", command: "pytest" }],
    );
    expect(parsePolicy({ verify: { checks: [] } }).verify.checks).toEqual([]);
    expect(parsePolicy({ verify: {} }).verify.checks).toBeNull();
  });
});

describe("permissionRulesForTool", () => {
  it("normalizes a bare action and keeps declaration order", () => {
    expect(permissionRulesForTool("deny")).toEqual([["*", "deny"]]);
    expect(permissionRulesForTool({ "rm *": "deny", "*": "allow" })).toEqual([
      ["rm *", "deny"],
      ["*", "allow"],
    ]);
    expect(permissionRulesForTool(undefined)).toEqual([]);
  });
});

describe("loadPolicy", () => {
  function wsWith(files: Record<string, string>): Workspace {
    return {
      root: "/repo",
      exec: async (cmd) => {
        const m = /cat (\S+)/.exec(cmd);
        const key = m?.[1]?.replace(/^'|'$/g, "").replace("/repo/", "") ?? "";
        return { stdout: files[key] ?? "", stderr: "", code: 0 };
      },
    };
  }

  it("reads .mouse/policy.json", async () => {
    const p = await loadPolicy(wsWith({ ".mouse/policy.json": '{"loop":{"maxSteps":10}}' }));
    expect(p.loop.maxSteps).toBe(10);
  });

  it("falls back to .mouse/app.json#verify for checks", async () => {
    const p = await loadPolicy(
      wsWith({
        ".mouse/app.json": '{"verify":{"checks":{"typecheck":"pnpm typecheck"},"timeoutSec":300}}',
      }),
    );
    expect(p.verify.checks).toEqual([{ name: "typecheck", command: "pnpm typecheck" }]);
    expect(p.verify.timeoutSec).toBe(300);
  });

  it("policy.json's verify block wins over app.json", async () => {
    const p = await loadPolicy(
      wsWith({
        ".mouse/policy.json": '{"verify":{"checks":[]}}',
        ".mouse/app.json": '{"verify":{"checks":{"test":"x"}}}',
      }),
    );
    expect(p.verify.checks).toEqual([]);
  });
});
