import { describe, expect, it } from "vitest";
import {
  checksFromEcosystem,
  DETECT_ECOSYSTEM_COMMAND,
  detectEcosystem,
  detectEcosystemCommand,
  EMPTY_MANIFEST,
  parseEcosystemOutput,
} from "../src/detect.js";
import type { Workspace } from "../src/workspace.js";

function wsPrinting(stdout: string, root = "/workspace"): Workspace {
  return { root, exec: async () => ({ stdout, stderr: "", code: 0 }) };
}

describe("checksFromEcosystem", () => {
  it("python via pyproject -> pytest, with uv when locked", () => {
    expect(checksFromEcosystem({ ...EMPTY_MANIFEST, pyproject: true })).toEqual([
      { name: "pytest", command: "python3 -m pytest -q --maxfail=25 -p no:cacheprovider" },
    ]);
    expect(
      checksFromEcosystem({ ...EMPTY_MANIFEST, pyproject: true, uvLock: true })[0]?.command,
    ).toMatch(/^uv run --frozen pytest/);
    expect(
      checksFromEcosystem({ ...EMPTY_MANIFEST, pytestIni: true, poetryLock: true })[0]?.command,
    ).toMatch(/^poetry run pytest/);
  });

  it("setup.cfg alone is not enough; with a tests dir it is", () => {
    expect(checksFromEcosystem({ ...EMPTY_MANIFEST, setupCfg: true })).toEqual([]);
    expect(checksFromEcosystem({ ...EMPTY_MANIFEST, setupCfg: true, testsDir: true })).toHaveLength(
      1,
    );
  });

  it("go, rust, and make", () => {
    expect(checksFromEcosystem({ ...EMPTY_MANIFEST, goMod: true })).toEqual([
      { name: "go-test", command: "go test ./..." },
    ]);
    expect(checksFromEcosystem({ ...EMPTY_MANIFEST, cargoToml: true })).toEqual([
      { name: "cargo-test", command: "cargo test" },
    ]);
    expect(checksFromEcosystem({ ...EMPTY_MANIFEST, makefileTest: true })).toEqual([
      { name: "make-test", command: "make test" },
    ]);
  });

  it("package.json scripts come first and suppress make", () => {
    const m = {
      ...EMPTY_MANIFEST,
      packageJson: JSON.stringify({ scripts: { test: "vitest run", lint: "eslint ." } }),
      packageManager: "pnpm" as const,
      makefileTest: true,
      goMod: true,
    };
    expect(checksFromEcosystem(m).map((c) => c.command)).toEqual([
      "pnpm run test",
      "pnpm run lint",
      "go test ./...",
    ]);
  });

  it("nothing detected -> no checks", () => {
    expect(checksFromEcosystem(EMPTY_MANIFEST)).toEqual([]);
  });
});

describe("detectEcosystem", () => {
  it("parses the one-shot probe output", async () => {
    const out = [
      "F:pyproject.toml",
      "F:uv.lock",
      "D:tests",
      "M:test",
      "PM:pnpm",
      "PKG_BEGIN",
      '{"scripts":{"test":"jest"}}',
      "PKG_END",
    ].join("\n");
    const m = await detectEcosystem(wsPrinting(out));
    expect(m.pyproject).toBe(true);
    expect(m.uvLock).toBe(true);
    expect(m.testsDir).toBe(true);
    expect(m.makefileTest).toBe(true);
    expect(m.packageManager).toBe("pnpm");
    expect(m.packageJson).toBe('{"scripts":{"test":"jest"}}');
  });

  it("empty output is the empty manifest, and the probe never fails the caller", async () => {
    expect(parseEcosystemOutput("")).toEqual(EMPTY_MANIFEST);
    const failing: Workspace = {
      root: "/x",
      exec: async () => {
        throw new Error("boom");
      },
    };
    expect(await detectEcosystem(failing)).toEqual(EMPTY_MANIFEST);
  });

  it("is one shell round trip that exits 0 outside a workspace", () => {
    expect(DETECT_ECOSYSTEM_COMMAND.startsWith("cd /workspace 2>/dev/null || exit 0")).toBe(true);
    expect(DETECT_ECOSYSTEM_COMMAND.endsWith("; true")).toBe(true);
  });

  it("quotes roots that need it and leaves plain ones bare", () => {
    expect(detectEcosystemCommand("/workspace")).toBe(DETECT_ECOSYSTEM_COMMAND);
    expect(detectEcosystemCommand("/tmp/my repo")).toMatch(/^cd '\/tmp\/my repo' /);
    const cmds: string[] = [];
    const ws: Workspace = {
      root: "/app",
      exec: async (c) => {
        cmds.push(c);
        return { stdout: "", stderr: "", code: 0 };
      },
    };
    return detectEcosystem(ws).then(() => expect(cmds[0]).toMatch(/^cd \/app /));
  });
});
