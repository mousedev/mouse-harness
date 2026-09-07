/**
 * The one thing the loop needs from the outside world: a directory and a way
 * to run a shell command in it. The CLI implements it over the local machine
 * (`localWorkspace`); a hosted product implements it over its sandbox.
 */
export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface ExecOptions {
  cwd?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface Workspace {
  /** Absolute path of the checkout the agent works in. */
  readonly root: string;
  exec(command: string, opts?: ExecOptions): Promise<ExecResult>;
}

/**
 * Quote a path for `sh`. Plain paths stay bare so commands built for the
 * conventional `/workspace` root are byte-identical to the historical ones.
 */
export function shellPath(p: string): string {
  return /^[A-Za-z0-9_./-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`;
}
