import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OpencodeRunEngine } from "../src/run-engine.js";

/**
 * A stand-in `opencode` that speaks the `run --format=json` protocol. Its
 * behaviour comes from FAKE_MODE: `ok` prints a two-step turn, `flaky` fails
 * with a transient error on the first call and succeeds on the second, and
 * `dead` prints nothing and exits 1 every time.
 */
const FAKE = `#!/usr/bin/env bash
mode="\${FAKE_MODE:-ok}"
count_file="\${FAKE_COUNT_FILE:?}"
n=$(( $(cat "$count_file" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$count_file"
echo "ARGS:$*" >&2
if [ "$mode" = dead ]; then exit 1; fi
if [ "$mode" = flaky ] && [ "$n" = 1 ]; then
  echo '{"type":"error","sessionID":"ses_1","error":{"name":"APIError","data":{"message":"503 service unavailable"}}}'
  exit 1
fi
echo '{"type":"step_start","sessionID":"ses_1"}'
echo '{"type":"tool_use","sessionID":"ses_1","part":{"tool":"bash"}}'
echo '{"type":"step_finish","sessionID":"ses_1","part":{"cost":0.01,"tokens":{"input":100,"output":20,"cache":{"read":50,"write":5}}}}'
echo '{"type":"text","sessionID":"ses_1","part":{"text":"first"}}'
echo '{"type":"step_finish","sessionID":"ses_1","part":{"cost":0.02,"tokens":{"input":200,"output":30,"cache":{"read":0,"write":0}}}}'
echo '{"type":"text","sessionID":"ses_1","part":{"text":"done"}}'
`;

let dir: string;
let bin: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "mouse-engine-"));
  bin = path.join(dir, "opencode");
  writeFileSync(bin, FAKE);
  chmodSync(bin, 0o755);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function engine(
  mode: string,
  extra: Partial<ConstructorParameters<typeof OpencodeRunEngine>[0]> = {},
) {
  const countFile = path.join(dir, `count-${mode}-${Math.random()}`);
  const lines: string[] = [];
  const errs: string[] = [];
  const records: Record<string, unknown>[] = [];
  const e = new OpencodeRunEngine({
    bin,
    cwd: dir,
    model: "prov/model",
    env: { ...process.env, FAKE_MODE: mode, FAKE_COUNT_FILE: countFile },
    passthrough: (l) => lines.push(l),
    passthroughErr: (l) => errs.push(l),
    trace: (r) => records.push(r),
    maxAttempts: 3,
    ...extra,
  });
  return { e, lines, errs, records };
}

describe("OpencodeRunEngine", () => {
  it("passes every stdout line through and sums steps, tokens, and text", async () => {
    const { e, lines, errs } = engine("ok");
    await e.open({ title: "my task" });
    const r = await e.prompt("", "do it", new AbortController().signal);
    expect(r.steps).toBe(2);
    expect(r.text).toBe("first\ndone");
    expect(e.sessionId).toBe("ses_1");
    expect(e.steps).toBe(2);
    expect(e.tokens).toEqual({ input: 300, output: 50, cacheRead: 50, cacheWrite: 5, cost: 0.03 });
    expect(lines).toHaveLength(6);
    expect(errs[0]).toMatch(
      /^ARGS:run --format=json --agent build --model prov\/model --dangerously-skip-permissions --title my task -- do it$/,
    );
  });

  it("continues the session on the second prompt and can switch model", async () => {
    const { e, errs } = engine("ok");
    await e.prompt("", "one", new AbortController().signal);
    await e.prompt("ses_1", "two", new AbortController().signal, { model: "prov/big" });
    expect(errs[1]).toMatch(
      /--model prov\/big --dangerously-skip-permissions --session ses_1 -- two$/,
    );
    expect(e.steps).toBe(4);
  });

  it("retries an empty turn that died on a transient error", async () => {
    const { e, records } = engine("flaky");
    const r = await e.prompt("", "go", new AbortController().signal);
    expect(r.steps).toBe(2);
    expect(records.map((x) => [x.attempt, x.steps, x.transientError])).toEqual([
      [1, 0, true],
      [2, 2, false],
    ]);
  });

  it("gives up after the attempt budget", async () => {
    const { e } = engine("dead", { maxAttempts: 2 });
    await expect(e.prompt("", "go", new AbortController().signal)).rejects.toThrow(
      /no steps after 2 attempts/,
    );
  });

  it("omits --dangerously-skip-permissions when asked", () => {
    const { e } = engine("ok", { skipPermissions: false, agent: "plan" });
    expect(e.argsFor("x")).toEqual([
      "run",
      "--format=json",
      "--agent",
      "plan",
      "--model",
      "prov/model",
      "--",
      "x",
    ]);
  });
});

describe("OpencodeRunEngine title", () => {
  it("keeps --title on continuation turns, as the benchmark run did", async () => {
    const { e, errs } = engine("ok");
    await e.open({ title: "t" });
    await e.prompt("", "one", new AbortController().signal);
    await e.prompt("ses_1", "two", new AbortController().signal);
    expect(errs[0]).toContain("--title t -- one");
    expect(errs[1]).toContain("--session ses_1 --title t -- two");
  });
});
