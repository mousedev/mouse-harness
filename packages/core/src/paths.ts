/**
 * Where Mouse keeps its own state: `~/.mouse/runs/--<cwd>--/`. Nothing is
 * ever written into the user's repository; `.mouse/` there holds only
 * user-authored policy.
 */
import { homedir } from "node:os";
import path from "node:path";

export function mouseHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.MOUSE_HOME?.trim() || path.join(homedir(), ".mouse");
}

/** `/Users/me/repo` becomes `--Users-me-repo--`, the same scheme pi uses. */
export function workspaceSlug(cwd: string): string {
  const abs = path
    .resolve(cwd)
    .replace(/[/\\:]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `--${abs || "root"}--`;
}

export function runsDir(cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(mouseHome(env), "runs", workspaceSlug(cwd));
}

/** A fresh trace path for a run starting now. */
export function traceFile(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  now = new Date(),
): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return path.join(runsDir(cwd, env), `${stamp}-${process.pid}.jsonl`);
}
