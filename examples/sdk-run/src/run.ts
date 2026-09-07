/**
 * Drive the Mouse loop from your own code instead of the CLI.
 *
 *   node --experimental-strip-types src/run.ts "Add a --json flag to the CLI"
 *
 * Everything the CLI does is here in forty lines: a workspace, a probe, an
 * engine, and `runCompletionLoop`. Swap `OpencodeRunEngine` for anything that
 * implements `Engine` to put the loop on another engine.
 */
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  headSha,
  loadPolicy,
  localWorkspace,
  makeProbe,
  runCompletionLoop,
} from "@mousedev/harness-core";
import { buildOpencodeConfig, OpencodeRunEngine } from "@mousedev/harness-opencode";

const instruction = process.argv.slice(2).join(" ") || "Make the test suite pass.";
const model = process.env.MOUSE_MODEL ?? "openrouter/moonshotai/kimi-k3";
const root = process.cwd();

const ws = localWorkspace({ root });
const policy = await loadPolicy(ws);
const marker = path.join(tmpdir(), `mouse-example-${process.pid}`);
writeFileSync(marker, "");
const abort = new AbortController();
const runStartSha = await headSha(ws);
const probe = makeProbe({
  workspace: ws,
  runStartSha,
  marker,
  signal: abort.signal,
  checks: policy.verify.checks,
});
const initialFingerprint = await probe.fingerprint();

const engine = new OpencodeRunEngine({
  cwd: root,
  model,
  env: {
    ...process.env,
    OPENCODE_CONFIG_CONTENT: JSON.stringify(buildOpencodeConfig({ profile: "local", model })),
  },
  passthroughErr: (line) => console.error(line),
});

const startedAt = Date.now();
const sessionId = await engine.open({ title: instruction.slice(0, 60) });
await engine.prompt(sessionId, instruction, abort.signal);

const result = await runCompletionLoop({
  probe,
  engine,
  sessionId: engine.sessionId ?? sessionId,
  model,
  signal: abort.signal,
  instruction,
  budget: {
    maxWallMs: policy.loop.maxWallSec * 1000,
    maxTotalSteps: policy.loop.maxSteps,
    maxNonProgressRounds: policy.loop.nonProgressRounds,
  },
  startedAt,
  initialFingerprint,
  steps: () => engine.steps,
  lastAssistantText: () => engine.lastText,
  onEvent: (e) =>
    console.log(e.type === "check_status" ? `check ${e.name}: ${e.conclusion}` : e.message),
  onRound: (r) => console.log(`round ${r.round} (${r.kind}) progressed=${r.progressed}`),
});

console.log(
  `${result.outcome} after ${result.rounds.length} rounds, ${result.totalSteps} steps, $${engine.tokens.cost.toFixed(2)}`,
);
process.exit(result.outcome === "satisfied" ? 0 : 3);
