/**
 * Find the `opencode` binary: explicit flag, then `MOUSE_OPENCODE_BIN`, then
 * PATH, then the nearest `node_modules/.bin/opencode` above the workspace.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export interface LocateOptions {
  flag?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

export function locateOpencode(o: LocateOptions = {}): string | null {
  const env = o.env ?? process.env;
  if (o.flag) {
    // A path must exist; a bare name is looked up on PATH like any other.
    if (o.flag.includes(path.sep)) return existsSync(o.flag) ? o.flag : null;
    return whichNamed(o.flag, env) ?? o.flag;
  }
  if (env.MOUSE_OPENCODE_BIN?.trim()) return env.MOUSE_OPENCODE_BIN.trim();
  const onPath = whichOpencode(env);
  if (onPath) return onPath;
  let dir = path.resolve(o.cwd ?? process.cwd());
  for (;;) {
    const candidate = path.join(dir, "node_modules", ".bin", "opencode");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function whichOpencode(env: NodeJS.ProcessEnv): string | null {
  return whichNamed("opencode", env);
}

function whichNamed(name: string, env: NodeJS.ProcessEnv): string | null {
  for (const dir of (env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** `opencode --version` output, or null when the binary cannot run. */
export function opencodeVersion(bin: string, timeoutMs = 20_000): string | null {
  try {
    return execFileSync(bin, ["--version"], { encoding: "utf8", timeout: timeoutMs }).trim();
  } catch {
    return null;
  }
}
