/**
 * What the loop needs from a model engine: open a session, send it a prompt,
 * learn how many steps it took and what it said last. `OpencodeRunEngine`
 * in `@mousedev/harness-opencode` is the reference implementation.
 */
export interface TokenTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** USD as reported by the engine; 0 when the engine does not price the model. */
  cost: number;
}

export interface PromptResult {
  steps: number;
  text: string;
}

export interface PromptOptions {
  /** Override the session's model for this turn (model escalation). */
  model?: string;
}

export interface Engine {
  open(opts?: { sessionId?: string; title?: string }): Promise<string>;
  prompt(
    sessionId: string,
    text: string,
    signal: AbortSignal,
    opts?: PromptOptions,
  ): Promise<PromptResult>;
  abort(sessionId: string): Promise<void>;
  readonly steps: number;
  readonly tokens: TokenTotals;
  readonly lastText: string;
}
