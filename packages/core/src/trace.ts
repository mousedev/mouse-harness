/**
 * The JSONL trace: one record per line, `mouse.start` first. Versioned by
 * `TRACE_VERSION` on the start record; readers should ignore unknown types.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { TokenTotals } from "./engine.js";
import type { LoopEvent } from "./events.js";
import type { CompletionOutcome, CompletionRound } from "./loop.js";

export const TRACE_VERSION = 1;

export type TraceRecord =
  | {
      type: "mouse.start";
      v: typeof TRACE_VERSION;
      version: string;
      model: string;
      workspace: string;
      profile: string;
      runStartSha: string | null;
      maxWallSec: number;
      configFile?: string;
    }
  | {
      type: "mouse.attempt";
      attempt: number;
      steps: number;
      exitCode: number | null;
      timedOut: boolean;
      transientError: boolean;
      error: string | null;
      sessionId: string | null;
    }
  | { type: "mouse.turn"; steps: number; tokens: TokenTotals; sessionId: string | null }
  | { type: "mouse.event"; event: LoopEvent }
  | ({ type: "mouse.round" } & CompletionRound)
  | {
      type: "mouse.done";
      outcome: CompletionOutcome;
      rounds: number;
      totalSteps: number;
      tokens: TokenTotals;
      elapsedMs: number;
      sessionId: string | null;
    }
  | { type: "mouse.error"; error: string; steps: number; elapsedMs: number };

export type TraceWriter = {
  readonly file: string;
  write(record: TraceRecord | Record<string, unknown>): void;
};

export function openTrace(file: string): TraceWriter {
  const abs = path.resolve(file);
  mkdirSync(path.dirname(abs), { recursive: true });
  return {
    file: abs,
    write(record) {
      appendFileSync(abs, `${JSON.stringify({ ts: Date.now(), ...record })}\n`);
    },
  };
}

/** Parse a trace file's lines; malformed lines are skipped. */
export function parseTrace(text: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line) as unknown;
      if (v && typeof v === "object") out.push(v as Record<string, unknown>);
    } catch {
      // skip
    }
  }
  return out;
}
