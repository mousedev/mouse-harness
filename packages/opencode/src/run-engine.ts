/**
 * `Engine` over the `opencode run --format=json` child process.
 *
 * This is the transport benchmark adapters use for stock OpenCode, so a Mouse
 * run and an OpenCode control run differ only in Mouse's config, prompt, and
 * completion loop. Every JSON line the engine prints is passed through
 * unchanged (Harbor's trajectory parser and `tee` see one continuous log);
 * the engine only reads them to learn the session id, count steps, sum
 * tokens, and collect the final text.
 *
 * Zero-step watchdog: a turn that prints nothing for `idleTimeoutMs`, or dies
 * with a transient provider error before its first step, is killed and
 * re-run on the same session. That is the 0-turn hang FrontierHarness
 * recorded for OpenCode on python-statemachine.
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import {
  classifyInferenceFailure,
  type Engine,
  type PromptOptions,
  type PromptResult,
  type TokenTotals,
} from "@mousedev/harness-core";

export interface OpencodeRunEngineOptions {
  bin?: string;
  cwd: string;
  /** `provider/model`, as `opencode --model` expects. */
  model: string;
  agent?: string;
  env?: NodeJS.ProcessEnv;
  idleTimeoutMs?: number;
  maxAttempts?: number;
  /** Pass `--dangerously-skip-permissions`. The run engine has no one to ask, so this defaults on. */
  skipPermissions?: boolean;
  /** Every stdout line, verbatim. */
  passthrough?: (line: string) => void;
  /** Every stderr line. */
  passthroughErr?: (line: string) => void;
  /** Structured engine records (attempts, retries). */
  trace?: (record: Record<string, unknown>) => void;
  /** Extra argv appended before `--` (e.g. `--title`). */
  extraArgs?: string[];
}

interface RunAttempt {
  exitCode: number | null;
  steps: number;
  text: string;
  timedOut: boolean;
  transientError: boolean;
  errorMessage: string | null;
}

const DEFAULT_IDLE_MS = 600_000;
const DEFAULT_ATTEMPTS = 3;

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export class OpencodeRunEngine implements Engine {
  sessionId: string | null = null;
  steps = 0;
  lastText = "";
  tokens: TokenTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  private title: string | undefined;
  private child: ReturnType<typeof spawn> | null = null;

  constructor(private readonly opts: OpencodeRunEngineOptions) {}

  /**
   * `opencode run` creates the session on the first prompt, so `open` only
   * records what to name it. Pass `sessionId` to continue an existing one.
   */
  async open(opts: { sessionId?: string; title?: string } = {}): Promise<string> {
    if (opts.sessionId) this.sessionId = opts.sessionId;
    this.title = opts.title;
    return this.sessionId ?? "";
  }

  async prompt(
    _sessionId: string,
    text: string,
    signal: AbortSignal,
    opts?: PromptOptions,
  ): Promise<PromptResult> {
    const max = this.opts.maxAttempts ?? DEFAULT_ATTEMPTS;
    const model = opts?.model ?? this.opts.model;
    let steps = 0;
    for (let attempt = 1; attempt <= max; attempt++) {
      if (signal.aborted) throw Object.assign(new Error("Aborted"), { name: "AbortError" });
      const r = await this.spawnOnce(text, model, signal);
      this.steps += r.steps;
      steps += r.steps;
      if (r.text) this.lastText = r.text;
      this.opts.trace?.({
        type: "mouse.attempt",
        attempt,
        steps: r.steps,
        exitCode: r.exitCode,
        timedOut: r.timedOut,
        transientError: r.transientError,
        error: r.errorMessage,
        sessionId: this.sessionId,
      });
      // A turn that did real work is done even if the process exited non-zero
      // (the engine reports late errors that way). Only an empty turn retries.
      if (r.steps > 0) return { steps, text: this.lastText };
      const retryable = r.timedOut || r.transientError || r.exitCode !== 0;
      if (!retryable) return { steps, text: this.lastText };
      if (attempt === max) {
        throw new Error(
          `opencode run produced no steps after ${max} attempts${r.errorMessage ? `: ${r.errorMessage}` : ""}`,
        );
      }
      await new Promise((res) => setTimeout(res, Math.min(30_000, 2_000 * 2 ** (attempt - 1))));
    }
    return { steps, text: this.lastText };
  }

  async abort(): Promise<void> {
    this.child?.kill("SIGKILL");
  }

  /** The argv for one turn; exported for tests and for `mouse doctor`. */
  argsFor(prompt: string, model = this.opts.model): string[] {
    return [
      "run",
      "--format=json",
      "--agent",
      this.opts.agent ?? "build",
      "--model",
      model,
      ...(this.opts.skipPermissions === false ? [] : ["--dangerously-skip-permissions"]),
      ...(this.sessionId ? ["--session", this.sessionId] : []),
      ...(this.title && !this.sessionId ? ["--title", this.title] : []),
      ...(this.opts.extraArgs ?? []),
      "--",
      prompt,
    ];
  }

  private spawnOnce(prompt: string, model: string, signal: AbortSignal): Promise<RunAttempt> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.opts.bin ?? "opencode", this.argsFor(prompt, model), {
        cwd: this.opts.cwd,
        env: this.opts.env ?? process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.child = child;
      const attempt: RunAttempt = {
        exitCode: null,
        steps: 0,
        text: "",
        timedOut: false,
        transientError: false,
        errorMessage: null,
      };
      const texts: string[] = [];
      const idleMs = this.opts.idleTimeoutMs ?? DEFAULT_IDLE_MS;
      let idle = setTimeout(onIdle, idleMs);
      function onIdle() {
        attempt.timedOut = true;
        child.kill("SIGKILL");
      }
      const touch = () => {
        clearTimeout(idle);
        idle = setTimeout(onIdle, idleMs);
      };
      const onAbort = () => child.kill("SIGKILL");
      signal.addEventListener("abort", onAbort, { once: true });

      const out = createInterface({ input: child.stdout! });
      out.on("line", (line) => {
        touch();
        this.opts.passthrough?.(line);
        let ev: Record<string, unknown>;
        try {
          ev = JSON.parse(line) as Record<string, unknown>;
        } catch {
          return;
        }
        if (!ev || typeof ev !== "object") return;
        if (!this.sessionId && typeof ev.sessionID === "string" && ev.sessionID) {
          this.sessionId = ev.sessionID;
        }
        const part = (ev.part ?? {}) as Record<string, unknown>;
        switch (ev.type) {
          case "step_finish": {
            attempt.steps += 1;
            const tokens = (part.tokens ?? {}) as Record<string, unknown>;
            const cache = (tokens.cache ?? {}) as Record<string, unknown>;
            this.tokens.input += num(tokens.input);
            this.tokens.output += num(tokens.output);
            this.tokens.cacheRead += num(cache.read);
            this.tokens.cacheWrite += num(cache.write);
            this.tokens.cost += num(part.cost);
            break;
          }
          case "text": {
            if (typeof part.text === "string" && part.text.trim()) texts.push(part.text);
            break;
          }
          case "error": {
            const message = JSON.stringify(ev.error ?? "");
            attempt.errorMessage = message.slice(0, 500);
            if (classifyInferenceFailure(message, ev.error) === "transient") {
              attempt.transientError = true;
            }
            break;
          }
          default:
            break;
        }
      });
      const err = createInterface({ input: child.stderr! });
      err.on("line", (line) => {
        touch();
        this.opts.passthroughErr?.(line);
      });

      child.on("error", (e) => {
        clearTimeout(idle);
        signal.removeEventListener("abort", onAbort);
        this.child = null;
        reject(e);
      });
      child.on("close", (code) => {
        clearTimeout(idle);
        signal.removeEventListener("abort", onAbort);
        this.child = null;
        attempt.exitCode = code;
        attempt.text = texts.join("\n");
        resolve(attempt);
      });
    });
  }
}
