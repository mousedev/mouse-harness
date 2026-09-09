/**
 * `mouse`: the Mouse harness CLI.
 *
 *   mouse run "Add rate limiting to /api/upload and cover it with tests"
 *   mouse run --instruction-file task.md --model fireworks-ai/accounts/fireworks/models/kimi-k3 --profile bench --yolo
 *   mouse config [--profile local|bench] [--model M] [--out DIR]
 *   mouse init
 *   mouse doctor [--model M] [--strict-compat]
 *   mouse --version
 *
 * `run` drives one OpenCode session through the completion loop: first turn,
 * then probe / checks / tamper scan / audit until satisfied or a budget is
 * hit. Mouse's own records go to a JSONL trace under ~/.mouse/runs/; with
 * `--format json` OpenCode's event stream is passed through on stdout
 * unchanged, which is what benchmark runners parse.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  buildAgentPrompt,
  type CompletionOutcome,
  type CompletionRound,
  checksFromEcosystem,
  DEFAULT_POLICY,
  detectEcosystem,
  headSha,
  loadPolicy,
  localWorkspace,
  MOUSE_VERSION,
  makeProbe,
  openTrace,
  type Policy,
  type Profile,
  runCompletionLoop,
  runsDir,
  traceFile,
} from "@mousedev/harness-core";
import {
  buildOpencodeConfig,
  checkCompat,
  locateOpencode,
  mergeConfig,
  OpencodeRunEngine,
  opencodeVersion,
  PRUNE_PLUGIN_FILENAME,
  prunePluginSource,
  versionLine,
} from "@mousedev/harness-opencode";

export const EXIT = {
  satisfied: 0,
  error: 1,
  usage: 2,
  budget: 3,
  blocked: 4,
  aborted: 130,
} as const;

export function exitCodeFor(outcome: CompletionOutcome): number {
  switch (outcome) {
    case "satisfied":
      return EXIT.satisfied;
    case "blocked":
      return EXIT.blocked;
    case "aborted":
      return EXIT.aborted;
    default:
      return EXIT.budget;
  }
}

function configHomeFromEnv(env = process.env): string {
  return path.join(env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config"), "opencode");
}

function fail(message: string): never {
  throw new UsageError(message);
}

class UsageError extends Error {}

/**
 * Write Mouse's bench config over whatever is already in the config home.
 * A benchmark runner may have registered a provider there first (a custom
 * base URL, an egress proxy, MCP servers); replacing the file would drop it.
 */
export function writeBenchConfig(
  configHome: string,
  model: string | undefined,
  policy: Policy,
): string {
  mkdirSync(configHome, { recursive: true });
  const file = path.join(configHome, "opencode.json");
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    existing = {};
  }
  const config = mergeConfig(
    existing,
    buildOpencodeConfig({ profile: "bench", model, permissions: policy.permissions }) as Record<
      string,
      unknown
    >,
  );
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  writePrunePlugin(configHome, policy);
  return file;
}

/** The prune plugin is opt-in (policy `context.prune.enabled`, or the legacy env flag). */
function writePrunePlugin(configHome: string, policy: Policy): string | null {
  const prune = policy.context.prune;
  if (!prune.enabled && process.env.MOUSE_TOOL_OUTPUT_PRUNE !== "1") return null;
  const pluginDir = path.join(configHome, "plugin");
  mkdirSync(pluginDir, { recursive: true });
  const file = path.join(pluginDir, PRUNE_PLUGIN_FILENAME);
  writeFileSync(file, prunePluginSource(prune));
  return file;
}

interface RunArgs {
  instruction: string;
  model: string;
  workspace: string;
  configHome: string;
  logFile: string | undefined;
  profile: Profile;
  yolo: boolean;
  /** Pass `--dangerously-skip-permissions` to OpenCode: `--yolo`, or no terminal to answer a prompt. */
  skipPermissions: boolean;
  /** True when permissions are skipped without `--yolo`, so the run should say so. */
  warnNoTerminal: boolean;
  format: "text" | "json";
  session: string | undefined;
  maxWallSec: number | undefined;
  maxSteps: number | undefined;
  nonProgressRounds: number | undefined;
  idleSec: number | undefined;
  opencodeBin: string | undefined;
}

function positiveInt(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n <= 0) fail(`expected a positive integer, got ${v}`);
  return n;
}

export function parseRunArgs(
  argv: string[],
  env = process.env,
  isTTY = Boolean(process.stdout.isTTY),
): RunArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      "instruction-file": { type: "string" },
      model: { type: "string", short: "m" },
      workspace: { type: "string" },
      "config-home": { type: "string" },
      log: { type: "string" },
      profile: { type: "string" },
      yolo: { type: "boolean", default: false },
      format: { type: "string" },
      session: { type: "string" },
      "max-wall-sec": { type: "string" },
      "max-steps": { type: "string" },
      "non-progress-rounds": { type: "string" },
      "idle-timeout-sec": { type: "string" },
      "opencode-bin": { type: "string" },
    },
    strict: true,
  });
  let instruction = positionals.join(" ").trim();
  if (values["instruction-file"]) {
    if (instruction) fail("pass the task as text or --instruction-file, not both");
    instruction = readFileSync(values["instruction-file"], "utf8").trim();
  }
  if (!instruction) fail('a task is required: mouse run "task" or --instruction-file FILE');
  const model = values.model ?? env.MOUSE_MODEL;
  if (!model?.includes("/")) fail("--model provider/model is required (or set MOUSE_MODEL)");
  const profile = (values.profile ?? "local") as Profile;
  if (profile !== "local" && profile !== "bench")
    fail(`--profile must be local or bench, got ${profile}`);
  const format = (values.format ?? (isTTY ? "text" : "json")) as "text" | "json";
  if (format !== "text" && format !== "json") fail(`--format must be text or json, got ${format}`);
  return {
    instruction,
    model,
    workspace: path.resolve(values.workspace ?? process.cwd()),
    configHome: values["config-home"] ?? configHomeFromEnv(env),
    logFile: values.log ?? env.MOUSE_HARNESS_LOG,
    profile,
    yolo: values.yolo,
    // `opencode run` reads no stdin, so a permission prompt could never be
    // answered; without a terminal the only workable mode is to skip them.
    skipPermissions: values.yolo || !isTTY,
    warnNoTerminal: !values.yolo && !isTTY,
    format,
    session: values.session,
    maxWallSec: positiveInt(values["max-wall-sec"] ?? env.MOUSE_MAX_WALL_SEC),
    maxSteps: positiveInt(values["max-steps"]),
    nonProgressRounds: positiveInt(values["non-progress-rounds"]),
    idleSec: positiveInt(values["idle-timeout-sec"]),
    opencodeBin: values["opencode-bin"],
  };
}

async function runCommand(argv: string[]): Promise<number> {
  const args = parseRunArgs(argv);
  const startedAt = Date.now();
  const ws = localWorkspace({ root: args.workspace });
  const policy = await loadPolicy(ws);
  const budget = {
    maxWallSec: args.maxWallSec ?? policy.loop.maxWallSec,
    maxSteps: args.maxSteps ?? policy.loop.maxSteps,
    nonProgressRounds: args.nonProgressRounds ?? policy.loop.nonProgressRounds,
    idleSec: args.idleSec ?? policy.loop.idleTimeoutSec,
  };
  const trace = openTrace(args.logFile ?? traceFile(args.workspace));
  const say = (line: string) => {
    if (args.format === "text") process.stdout.write(`${line}\n`);
  };

  const bin = locateOpencode({ flag: args.opencodeBin, cwd: args.workspace });
  if (!bin)
    fail(
      "opencode not found: install it (npm i -g opencode-ai), or pass --opencode-bin / MOUSE_OPENCODE_BIN",
    );

  const env: NodeJS.ProcessEnv = { ...process.env };
  let configFile: string | undefined;
  if (args.profile === "bench") {
    configFile = writeBenchConfig(args.configHome, args.model, policy);
  } else {
    // Local profile: hand OpenCode the config in memory. It layers over the
    // user's own config files, which stay untouched.
    env.OPENCODE_CONFIG_CONTENT = JSON.stringify(
      buildOpencodeConfig({ profile: "local", model: args.model, permissions: policy.permissions }),
    );
    const plugin = writePrunePlugin(args.configHome, policy);
    if (plugin) say(`mouse: wrote ${plugin} (context.prune is enabled in .mouse/policy.json)`);
  }
  if (args.warnNoTerminal) {
    process.stderr.write(
      "mouse: no terminal to answer permission prompts; running as if --yolo was passed\n",
    );
  }

  const marker = path.join(tmpdir(), `mouse-${process.pid}.marker`);
  writeFileSync(marker, "");
  const abort = new AbortController();
  const onSignal = () => abort.abort();
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);

  const runStartSha = await headSha(ws);
  const probe = makeProbe({
    workspace: ws,
    runStartSha,
    marker,
    signal: abort.signal,
    checks: policy.verify.checks,
    checkTimeoutMs: policy.verify.timeoutSec * 1000,
  });
  const initialFingerprint = await probe.fingerprint();
  trace.write({
    type: "mouse.start",
    v: 1,
    version: MOUSE_VERSION,
    model: args.model,
    workspace: args.workspace,
    profile: args.profile,
    runStartSha,
    maxWallSec: budget.maxWallSec,
    ...(configFile ? { configFile } : {}),
  });

  const engine = new OpencodeRunEngine({
    bin,
    cwd: args.workspace,
    model: args.model,
    agent: "build",
    env,
    idleTimeoutMs: budget.idleSec * 1000,
    skipPermissions: args.skipPermissions,
    passthrough: (line) => {
      if (args.format === "json") process.stdout.write(`${line}\n`);
    },
    passthroughErr: (line) => process.stderr.write(`${line}\n`),
    trace: (r) => trace.write(r),
  });

  say(`mouse ${MOUSE_VERSION}: ${args.model}, profile ${args.profile}, trace ${trace.file}`);
  let exitCode: number = EXIT.error;
  try {
    const sessionId = await engine.open({
      sessionId: args.session,
      title: args.instruction.slice(0, 60).replace(/\s+/g, " "),
    });
    const first = await engine.prompt(sessionId, args.instruction, abort.signal);
    trace.write({
      type: "mouse.turn",
      steps: engine.steps,
      tokens: engine.tokens,
      sessionId: engine.sessionId,
    });
    say(`turn 1: ${first.steps} steps`);

    const result = await runCompletionLoop({
      probe,
      engine,
      sessionId: engine.sessionId ?? sessionId,
      model: args.model,
      signal: abort.signal,
      instruction: args.instruction,
      onEvent: (e) => {
        trace.write({ type: "mouse.event", event: e });
        if (e.type === "check_status") say(`check ${e.name}: ${e.conclusion}`);
        else say(`notice: ${e.message}`);
      },
      budget: {
        maxWallMs: budget.maxWallSec * 1000,
        maxTotalSteps: budget.maxSteps,
        maxNonProgressRounds: budget.nonProgressRounds,
        minRoundMs: policy.loop.minRoundSec * 1000,
      },
      startedAt,
      initialFingerprint,
      steps: () => engine.steps,
      lastAssistantText: () => engine.lastText,
      onRound: (r: CompletionRound) => {
        trace.write({ type: "mouse.round", ...r });
        say(
          `round ${r.round} (${r.kind}): ${r.progressed ? "progressed" : "no change"}, ${r.stepsAfter} steps total`,
        );
      },
    });
    trace.write({
      type: "mouse.done",
      outcome: result.outcome,
      rounds: result.rounds.length,
      checksRun: result.rounds.at(-1)?.checksRun ?? [],
      totalSteps: result.totalSteps,
      tokens: engine.tokens,
      elapsedMs: Date.now() - startedAt,
      sessionId: engine.sessionId,
    });
    if (args.format === "text" && engine.lastText) say(`\n${engine.lastText}\n`);
    say(
      `outcome: ${result.outcome} after ${result.rounds.length} round(s), ${result.totalSteps} steps, ${Math.round((Date.now() - startedAt) / 1000)}s, $${engine.tokens.cost.toFixed(2)}`,
    );
    exitCode = exitCodeFor(result.outcome);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    trace.write({
      type: "mouse.error",
      error: message,
      steps: engine.steps,
      elapsedMs: Date.now() - startedAt,
    });
    process.stderr.write(`mouse: ${message}\n`);
    exitCode = EXIT.error;
  } finally {
    process.off("SIGTERM", onSignal);
    process.off("SIGINT", onSignal);
  }
  return exitCode;
}

async function configCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      out: { type: "string" },
      model: { type: "string" },
      profile: { type: "string" },
      workspace: { type: "string" },
    },
    strict: true,
  });
  const profile = (values.profile ?? "local") as Profile;
  const ws = localWorkspace({ root: path.resolve(values.workspace ?? process.cwd()) });
  const policy = await loadPolicy(ws);
  if (profile === "bench") {
    const file = writeBenchConfig(values.out ?? configHomeFromEnv(), values.model, policy);
    process.stdout.write(
      `wrote ${file}\n\n--- agent prompt (build) ---\n${buildAgentPrompt("build", { profile })}\n`,
    );
    return 0;
  }
  const config = buildOpencodeConfig({
    profile: "local",
    model: values.model,
    permissions: policy.permissions,
  });
  process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
  return 0;
}

const POLICY_SKELETON = {
  $docs: "https://github.com/mousedev/mouse-harness/blob/main/docs/config.md",
  version: 1,
  verify: { timeoutSec: DEFAULT_POLICY.verify.timeoutSec },
  loop: { ...DEFAULT_POLICY.loop },
  context: { prune: { ...DEFAULT_POLICY.context.prune } },
  permissions: { bash: { "git push*": "deny", "rm -rf *": "deny" } },
};

function initCommand(argv: string[]): number {
  const { values } = parseArgs({
    args: argv,
    options: { workspace: { type: "string" } },
    strict: true,
  });
  const root = path.resolve(values.workspace ?? process.cwd());
  const dir = path.join(root, ".mouse");
  const file = path.join(dir, "policy.json");
  try {
    readFileSync(file);
    process.stdout.write(`${file} already exists; nothing written\n`);
    return 0;
  } catch {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, `${JSON.stringify(POLICY_SKELETON, null, 2)}\n`);
    process.stdout.write(`wrote ${file}\n`);
    return 0;
  }
}

const PROVIDER_KEY_ENV: Record<string, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  "fireworks-ai": ["FIREWORKS_API_KEY"],
  moonshotai: ["MOONSHOT_API_KEY"],
  togetherai: ["TOGETHER_API_KEY"],
  google: ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"],
};

async function doctorCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      model: { type: "string" },
      workspace: { type: "string" },
      "opencode-bin": { type: "string" },
      "strict-compat": { type: "boolean", default: false },
    },
    strict: true,
  });
  const lines: string[] = [];
  let failed = false;
  const root = path.resolve(values.workspace ?? process.cwd());
  const bin = locateOpencode({ flag: values["opencode-bin"], cwd: root });
  const version = bin ? opencodeVersion(bin) : null;
  const compat = checkCompat(version);
  lines.push(`mouse      ${MOUSE_VERSION}`);
  lines.push(
    `opencode   ${bin ?? "not found (npm i -g opencode-ai)"}${version ? ` (${version})` : ""}`,
  );
  if (!bin || !version) failed = true;
  if (compat.level === "supported") lines.push(`compat     ${compat.version}: supported`);
  else if (compat.level === "untested") {
    lines.push(
      `compat     ${compat.version}: untested (supported: ${compat.supported.join(", ")})`,
    );
    if (values["strict-compat"]) failed = true;
  } else lines.push("compat     unknown");

  const model = values.model ?? process.env.MOUSE_MODEL;
  if (model?.includes("/")) {
    const provider = model.split("/")[0]!;
    const envs = PROVIDER_KEY_ENV[provider] ?? [
      `${provider.toUpperCase().replace(/-/g, "_")}_API_KEY`,
    ];
    const present = envs.find((e) => process.env[e]);
    lines.push(
      `provider   ${provider}: ${present ? `${present} set` : `${envs.join("/")} not in env (opencode's own auth store may hold it: opencode auth list)`}`,
    );
  } else {
    lines.push("provider   pass --model provider/model to check its key");
  }

  const ws = localWorkspace({ root });
  const sha = await headSha(ws);
  lines.push(
    `git        ${sha ? `repo at ${sha.slice(0, 12)}` : "not a git repo (fingerprint falls back to mtime scan)"}`,
  );
  const policy = await loadPolicy(ws);
  const checks = policy.verify.checks ?? checksFromEcosystem(await detectEcosystem(ws));
  lines.push(
    `checks     ${checks.length ? checks.map((c) => `${c.name} (${c.command})`).join("; ") : "none detected; the loop can only prove that files changed"}${policy.verify.checks ? " [from .mouse/policy.json]" : ""}`,
  );
  lines.push(`traces     ${runsDir(root)}`);
  process.stdout.write(`${lines.join("\n")}\n`);
  return failed ? 1 : 0;
}

function versionCommand(argv: string[]): number {
  const { values } = parseArgs({
    args: argv,
    options: { "opencode-bin": { type: "string" } },
    strict: true,
  });
  const bin = locateOpencode({ flag: values["opencode-bin"] });
  process.stdout.write(`${versionLine(bin ? opencodeVersion(bin) : null)}\n`);
  return 0;
}

const USAGE = `mouse ${MOUSE_VERSION}: run OpenCode in a repo until its checks pass.

usage:
  mouse run "task" | --instruction-file F   --model provider/model [--workspace DIR]
           [--profile local|bench] [--yolo] [--format text|json] [--log FILE] [--session ID]
           [--max-wall-sec N] [--max-steps N] [--non-progress-rounds N] [--idle-timeout-sec N]
           [--config-home DIR] [--opencode-bin PATH]
  mouse config [--profile local|bench] [--model M] [--out DIR]
  mouse init [--workspace DIR]
  mouse doctor [--model M] [--workspace DIR] [--strict-compat]
  mouse --version

exit codes: 0 satisfied, 1 error, 2 usage, 3 budget (stalled, wall clock, steps), 4 blocked, 130 aborted
`;

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case "run":
        return await runCommand(rest);
      case "config":
        return await configCommand(rest);
      case "init":
        return initCommand(rest);
      case "doctor":
        return await doctorCommand(rest);
      case "version":
      case "--version":
      case "-v":
        return versionCommand(rest);
      case "help":
      case "--help":
      case "-h":
        process.stdout.write(USAGE);
        return 0;
      default:
        process.stderr.write(USAGE);
        return EXIT.usage;
    }
  } catch (e) {
    if (e instanceof UsageError || (e instanceof TypeError && /option|argument/i.test(e.message))) {
      process.stderr.write(`mouse: ${e.message}\n`);
      return EXIT.usage;
    }
    throw e;
  }
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  (process.argv[1].endsWith("mouse.mjs") ||
    process.argv[1].endsWith("/mouse") ||
    process.argv[1].endsWith("cli/src/main.ts"));
if (invokedDirectly) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      process.stderr.write(`mouse: ${e instanceof Error ? e.message : String(e)}\n`);
      process.exit(EXIT.error);
    },
  );
}
