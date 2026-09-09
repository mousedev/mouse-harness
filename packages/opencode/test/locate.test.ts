import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { locateOpencode, opencodeVersion } from "../src/locate.js";

let dir: string;
let onPath: string;
let project: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "mouse-locate-"));
  onPath = path.join(dir, "bin");
  mkdirSync(onPath);
  writeFileSync(path.join(onPath, "opencode"), "#!/bin/sh\necho 1.2.3\n", { mode: 0o755 });
  project = path.join(dir, "project", "packages", "app");
  mkdirSync(path.join(dir, "project", "node_modules", ".bin"), { recursive: true });
  mkdirSync(project, { recursive: true });
  writeFileSync(path.join(dir, "project", "node_modules", ".bin", "opencode"), "");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("locateOpencode", () => {
  it("takes an explicit path only when it exists", () => {
    const real = path.join(onPath, "opencode");
    expect(locateOpencode({ flag: real, env: { PATH: "" } })).toBe(real);
    expect(locateOpencode({ flag: path.join(dir, "missing"), env: { PATH: "" } })).toBeNull();
  });

  it("resolves a bare flag on PATH, and hands it back unresolved otherwise", () => {
    expect(locateOpencode({ flag: "opencode", env: { PATH: onPath } })).toBe(
      path.join(onPath, "opencode"),
    );
    expect(locateOpencode({ flag: "opencode-x", env: { PATH: onPath } })).toBe("opencode-x");
  });

  it("prefers MOUSE_OPENCODE_BIN, then PATH, then the nearest node_modules/.bin", () => {
    expect(locateOpencode({ env: { MOUSE_OPENCODE_BIN: " /x/opencode ", PATH: onPath } })).toBe(
      "/x/opencode",
    );
    expect(locateOpencode({ env: { PATH: onPath }, cwd: project })).toBe(
      path.join(onPath, "opencode"),
    );
    expect(locateOpencode({ env: { PATH: "" }, cwd: project })).toBe(
      path.join(dir, "project", "node_modules", ".bin", "opencode"),
    );
    expect(locateOpencode({ env: { PATH: "" }, cwd: dir })).toBeNull();
  });

  it("walks PATHEXT on Windows", () => {
    // A directory holding only the .cmd shim npm installs on Windows.
    const winBin = path.join(dir, "winbin");
    mkdirSync(winBin);
    writeFileSync(path.join(winBin, "opencode.cmd"), "@echo 1.2.3\n");
    const win = { PATH: winBin, PATHEXT: ".COM;.EXE;.BAT;.CMD" };
    expect(locateOpencode({ env: win, platform: "win32" })).toBe(path.join(winBin, "opencode.cmd"));
    expect(locateOpencode({ env: win, platform: "linux" })).toBeNull();
  });
});

describe("opencodeVersion", () => {
  it("returns the trimmed --version output, or null when the binary cannot run", () => {
    expect(opencodeVersion(path.join(onPath, "opencode"))).toBe("1.2.3");
    expect(opencodeVersion(path.join(dir, "missing"))).toBeNull();
  });
});
