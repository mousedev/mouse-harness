import { DEFAULT_POLICY } from "@mousedev/harness-core";
import { describe, expect, it } from "vitest";
import { checkCompat, loadCompatManifest, parseOpencodeVersion } from "../src/compat.js";
import { prunePluginSource } from "../src/plugins/prune.js";
import { MOUSE_VERSION, versionLine } from "../src/version.js";

describe("compat", () => {
  it("ships a manifest whose supported versions are tested", () => {
    const m = loadCompatManifest();
    expect(m.supported).toContain("1.18.27");
    expect(m.supported).toContain("1.14.22");
    for (const v of m.supported) expect(m.tested[v]).toBeDefined();
  });

  it("parses version output and classifies", () => {
    expect(parseOpencodeVersion("1.14.22")).toBe("1.14.22");
    expect(parseOpencodeVersion("opencode 1.18.29\n")).toBe("1.18.29");
    expect(checkCompat("1.14.22")).toEqual({ level: "supported", version: "1.14.22" });
    expect(checkCompat("9.9.9")).toMatchObject({ level: "untested", version: "9.9.9" });
    expect(checkCompat(null)).toEqual({ level: "unknown", version: null });
  });
});

describe("prune plugin", () => {
  it("bakes the policy numbers into the plugin source", () => {
    const src = prunePluginSource({
      ...DEFAULT_POLICY.context.prune,
      thresholdChars: 100,
      headChars: 60,
      tailChars: 10,
    });
    expect(src).toContain("THRESHOLD = 100, HEAD = 60, TAIL = 10");
    expect(src).toContain('"tool.execute.after"');
  });
});

describe("version", () => {
  it("formats the line benchmark runners record", () => {
    expect(versionLine("1.14.22")).toBe(`mouse/${MOUSE_VERSION} opencode/1.14.22`);
    expect(versionLine(null)).toBe(`mouse/${MOUSE_VERSION} opencode/unavailable`);
  });
});
