import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localWorkspace } from "../src/exec.js";
import { deletedVerificationFiles, fingerprint, headSha } from "../src/git.js";
import { makeProbe } from "../src/probe.js";

let dir: string;
const git = (...args: string[]) =>
  execFileSync("git", ["-C", dir, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@x",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@x",
    },
  });

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "mouse-git-"));
  git("init", "-q");
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ scripts: { test: "exit 0", lint: "exit 3" } }),
  );
  writeFileSync(path.join(dir, "tests.txt"), "keep");
  git("add", ".");
  git("commit", "-q", "-m", "init");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("git helpers over a local workspace", () => {
  it("reads HEAD and changes the fingerprint on any edit", async () => {
    const ws = localWorkspace({ root: dir });
    const base = await headSha(ws);
    expect(base).toMatch(/^[0-9a-f]{40}$/);
    const before = await fingerprint(ws, base);
    writeFileSync(path.join(dir, "new.txt"), "hi");
    expect(await fingerprint(ws, base)).not.toBe(before);
  });

  it("flags deleted verification files only", async () => {
    const ws = localWorkspace({ root: dir });
    const base = await headSha(ws);
    expect(await deletedVerificationFiles(ws, base)).toEqual([]);
    rmSync(path.join(dir, "tests.txt"));
    expect(await deletedVerificationFiles(ws, base)).toEqual([]);
    git("checkout", "--", "tests.txt");
  });

  it("answers null and empty outside a repo", async () => {
    const plain = mkdtempSync(path.join(tmpdir(), "mouse-plain-"));
    try {
      const ws = localWorkspace({ root: plain });
      expect(await headSha(ws)).toBeNull();
      expect(await deletedVerificationFiles(ws, null)).toEqual([]);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});

describe("makeProbe", () => {
  it("runs detected package.json checks and reports exit codes", async () => {
    const ws = localWorkspace({ root: dir });
    const marker = path.join(dir, ".marker");
    writeFileSync(marker, "");
    const probe = makeProbe({
      workspace: ws,
      runStartSha: await headSha(ws),
      marker,
      signal: new AbortController().signal,
    });
    const checks = await probe.checks();
    expect(checks.map((c) => [c.name, c.pass, c.exitCode])).toEqual([
      ["test", true, 0],
      ["lint", false, 3],
    ]);
    expect(await probe.tampering()).toEqual([]);
  });

  it("honours declared checks and a timeout", async () => {
    const ws = localWorkspace({ root: dir });
    const probe = makeProbe({
      workspace: ws,
      runStartSha: null,
      marker: path.join(dir, ".marker"),
      signal: new AbortController().signal,
      checks: [{ name: "slow", command: "sleep 5" }],
      checkTimeoutMs: 200,
    });
    const [slow] = await probe.checks();
    expect(slow?.pass).toBe(false);
    expect(slow?.exitCode).toBeNull();
    expect(typeof (await probe.fingerprint())).toBe("string");
  });
});
