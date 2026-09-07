import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseTrace } from "@mousedev/harness-core";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EXIT, exitCodeFor, main, parseRunArgs } from "../src/main.js";

/**
 * A stand-in `opencode` that behaves like a model solving a task: on its
 * first call it writes the file the task asks for and answers with a text
 * event; on the second (the loop's audit round) it answers with a MOUSE_AUDIT
 * block. FAKE_MODE=lazy never edits, so the loop should stall.
 */
const FAKE = `#!/usr/bin/env bash
count_file="\${FAKE_COUNT_FILE:?}"
n=$(( $(cat "$count_file" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$count_file"
printf '%s\\n' "$*" >> "\${FAKE_COUNT_FILE}.args"
[ -n "$OPENCODE_CONFIG_CONTENT" ] && printf '%s' "$OPENCODE_CONFIG_CONTENT" > "\${FAKE_COUNT_FILE}.config"
echo '{"type":"step_start","sessionID":"ses_x"}'
if [ "\${FAKE_MODE:-solve}" = solve ] && [ "$n" = 1 ]; then echo "hello" > hello.txt; fi
echo '{"type":"step_finish","sessionID":"ses_x","part":{"cost":0.5,"tokens":{"input":10,"output":5,"cache":{"read":0,"write":0}}}}'
if [ "$n" -ge 2 ] && [ "\${FAKE_MODE:-solve}" = solve ]; then
  echo '{"type":"text","sessionID":"ses_x","part":{"text":"All done.\\nMOUSE_AUDIT\\n- [done] hello.txt: written\\nEND_MOUSE_AUDIT"}}'
else
  echo '{"type":"text","sessionID":"ses_x","part":{"text":"I did the thing."}}'
fi
`;

let dir: string;
let bin: string;
let repo: string;
const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@x",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@x",
};

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "mouse-cli-"));
  bin = path.join(dir, "opencode");
  writeFileSync(bin, FAKE);
  chmodSync(bin, 0o755);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function freshRepo(): string {
  const r = mkdtempSync(path.join(dir, "repo-"));
  execFileSync("git", ["-C", r, "init", "-q"], { env: gitEnv });
  writeFileSync(
    path.join(r, "package.json"),
    JSON.stringify({ scripts: { test: "test -f hello.txt" } }),
  );
  execFileSync("git", ["-C", r, "add", "."], { env: gitEnv });
  execFileSync("git", ["-C", r, "commit", "-q", "-m", "init"], { env: gitEnv });
  return r;
}

const stdoutSpy = () => vi.spyOn(process.stdout, "write").mockImplementation(() => true);
afterEach(() => vi.restoreAllMocks());

describe("exit codes", () => {
  it("map every outcome", () => {
    expect(exitCodeFor("satisfied")).toBe(0);
    expect(exitCodeFor("stalled")).toBe(EXIT.budget);
    expect(exitCodeFor("wall_clock")).toBe(EXIT.budget);
    expect(exitCodeFor("blocked")).toBe(EXIT.blocked);
    expect(exitCodeFor("aborted")).toBe(EXIT.aborted);
  });
});

describe("parseRunArgs", () => {
  it("takes the task as positional text or a file, requires a model", () => {
    const a = parseRunArgs(["Fix", "the", "bug", "--model", "p/m"], {}, true);
    expect(a.instruction).toBe("Fix the bug");
    expect(a.profile).toBe("local");
    expect(a.format).toBe("text");
    expect(parseRunArgs(["x", "--model", "p/m"], {}, false).format).toBe("json");
    expect(() => parseRunArgs(["x"], {}, true)).toThrow(/--model/);
    expect(() => parseRunArgs(["--model", "p/m"], {}, true)).toThrow(/task is required/);
    expect(() => parseRunArgs(["x", "--model", "p/m", "--profile", "prod"], {}, true)).toThrow(
      /--profile/,
    );
    expect(
      parseRunArgs(["x"], { MOUSE_MODEL: "p/m", MOUSE_MAX_WALL_SEC: "30" }, true).maxWallSec,
    ).toBe(30);
  });
});

describe("mouse run", () => {
  it("runs the first turn, then the audit round, and exits 0 when satisfied", async () => {
    repo = freshRepo();
    const countFile = path.join(dir, "count-solve");
    const log = path.join(dir, "solve.jsonl");
    process.env.FAKE_COUNT_FILE = countFile;
    process.env.FAKE_MODE = "solve";
    const out = stdoutSpy();
    const code = await main([
      "run",
      "Write hello.txt",
      "--model",
      "prov/model",
      "--workspace",
      repo,
      "--opencode-bin",
      bin,
      "--log",
      log,
      "--format",
      "json",
      "--max-wall-sec",
      "600",
    ]);
    expect(code).toBe(0);
    const records = parseTrace(readFileSync(log, "utf8"));
    const types = records.map((r) => r.type);
    expect(types[0]).toBe("mouse.start");
    expect(types).toContain("mouse.turn");
    expect(types.filter((t) => t === "mouse.round")).toHaveLength(1);
    expect(types.at(-1)).toBe("mouse.done");
    const done = records.at(-1)!;
    expect(done.outcome).toBe("satisfied");
    expect((done.tokens as { cost: number }).cost).toBeCloseTo(1.0);
    // The check ran and passed once the file existed.
    expect(
      records.some(
        (r) =>
          r.type === "mouse.event" && (r.event as { conclusion?: string }).conclusion === "success",
      ),
    ).toBe(true);
    // JSON format passes the engine's lines through on stdout.
    const written = out.mock.calls.map((c) => String(c[0])).join("");
    expect(written).toContain('"type":"step_finish"');
    // Local profile: config went through the environment, nothing under the repo changed but hello.txt.
    const cfg = JSON.parse(readFileSync(`${countFile}.config`, "utf8")) as {
      agent: Record<string, { prompt?: string }>;
    };
    expect(cfg.agent.build?.prompt).toMatch(/^You are Mouse/);
    expect(existsSync(path.join(repo, ".mouse"))).toBe(false);
    // Second call continued the same session.
    const args = readFileSync(`${countFile}.args`, "utf8").split("\n");
    expect(args[1]).toContain("--session ses_x");
  });

  it("stalls and exits 3 when the model never edits", async () => {
    repo = freshRepo();
    process.env.FAKE_COUNT_FILE = path.join(dir, "count-lazy");
    process.env.FAKE_MODE = "lazy";
    stdoutSpy();
    const code = await main([
      "run",
      "Write hello.txt",
      "--model",
      "prov/model",
      "--workspace",
      repo,
      "--opencode-bin",
      bin,
      "--log",
      path.join(dir, "lazy.jsonl"),
      "--format",
      "json",
      "--non-progress-rounds",
      "2",
      "--max-wall-sec",
      "600",
    ]);
    expect(code).toBe(EXIT.budget);
    const records = parseTrace(readFileSync(path.join(dir, "lazy.jsonl"), "utf8"));
    expect(records.at(-1)?.outcome).toBe("stalled");
    expect(records.filter((r) => r.type === "mouse.round")).toHaveLength(2);
  });

  it("bench profile writes opencode.json into the config home, merged over what is there", async () => {
    repo = freshRepo();
    const home = path.join(dir, "cfg-home");
    mkdirSync(home, { recursive: true });
    writeFileSync(
      path.join(home, "opencode.json"),
      JSON.stringify({ provider: { custom: { options: { baseURL: "http://x" } } } }),
    );
    process.env.FAKE_COUNT_FILE = path.join(dir, "count-bench");
    process.env.FAKE_MODE = "solve";
    stdoutSpy();
    const code = await main([
      "run",
      "Write hello.txt",
      "--model",
      "openrouter/moonshotai/kimi-k3",
      "--workspace",
      repo,
      "--opencode-bin",
      bin,
      "--log",
      path.join(dir, "bench.jsonl"),
      "--format",
      "json",
      "--profile",
      "bench",
      "--yolo",
      "--config-home",
      home,
      "--max-wall-sec",
      "600",
    ]);
    expect(code).toBe(0);
    const cfg = JSON.parse(readFileSync(path.join(home, "opencode.json"), "utf8"));
    expect(cfg.provider.custom.options.baseURL).toBe("http://x");
    expect(cfg.provider.openrouter.options.extraBody.provider.order).toEqual(["Fireworks"]);
    expect(cfg.small_model).toBe("openrouter/moonshotai/kimi-k3");
    expect(cfg.$schema).toBe("https://opencode.ai/config.json");
  });

  it("returns the usage code on bad arguments and when opencode is missing", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(await main(["run"])).toBe(EXIT.usage);
    expect(await main(["bogus"])).toBe(EXIT.usage);
    expect(
      await main([
        "run",
        "x",
        "--model",
        "p/m",
        "--opencode-bin",
        "/nonexistent/opencode",
        "--workspace",
        dir,
      ]),
    ).toBe(EXIT.usage);
  });
});

describe("init, config, doctor, version", () => {
  it("init writes a policy skeleton once", async () => {
    repo = freshRepo();
    stdoutSpy();
    expect(await main(["init", "--workspace", repo])).toBe(0);
    const file = path.join(repo, ".mouse", "policy.json");
    const policy = JSON.parse(readFileSync(file, "utf8"));
    expect(policy.loop.maxWallSec).toBe(780);
    writeFileSync(file, "{}");
    expect(await main(["init", "--workspace", repo])).toBe(0);
    expect(readFileSync(file, "utf8")).toBe("{}");
  });

  it("config prints the local profile and writes the bench one", async () => {
    const out = stdoutSpy();
    expect(await main(["config", "--model", "p/m", "--workspace", dir])).toBe(0);
    const printed = JSON.parse(out.mock.calls.map((c) => String(c[0])).join(""));
    expect(printed.agent.build.prompt).toMatch(/^You are Mouse/);
    expect(printed.autoupdate).toBeUndefined();
    const outDir = path.join(dir, "cfg-out");
    expect(
      await main([
        "config",
        "--profile",
        "bench",
        "--model",
        "p/m",
        "--out",
        outDir,
        "--workspace",
        dir,
      ]),
    ).toBe(0);
    expect(existsSync(path.join(outDir, "opencode.json"))).toBe(true);
  });

  it("doctor reports opencode, checks, and the trace directory", async () => {
    repo = freshRepo();
    const out = stdoutSpy();
    const code = await main([
      "doctor",
      "--workspace",
      repo,
      "--opencode-bin",
      bin,
      "--model",
      "openrouter/x",
    ]);
    const text = out.mock.calls.map((c) => String(c[0])).join("");
    expect(text).toMatch(/opencode\s+\S+opencode/);
    expect(text).toMatch(/checks\s+test \(npm run test --if-present\)/);
    expect(text).toMatch(/traces\s+.*--/);
    expect(text).toMatch(/provider\s+openrouter/);
    // The fake answers --version with JSON lines, so the version is unknown but present.
    expect(text).toMatch(/compat\s+unknown/);
    expect(code).toBe(0);
  });

  it("version prints the harness line", async () => {
    const out = stdoutSpy();
    expect(await main(["--version", "--opencode-bin", "/nonexistent"])).toBe(0);
    expect(out.mock.calls[0]?.[0]).toMatch(/^mouse\/0\.1\.0 opencode\/unavailable\n$/);
  });
});
