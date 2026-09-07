/**
 * Git helpers over a `Workspace`. Every command is `git -C <root>` so the
 * same code serves a local checkout and a hosted sandbox. All best-effort:
 * a non-repo answers with nulls and empty lists, never an exception.
 */
import { shellPath, type Workspace } from "./workspace.js";

const git = (ws: Workspace) => `git -C ${shellPath(ws.root)}`;

export async function headSha(ws: Workspace): Promise<string | null> {
  const r = await ws
    .exec(`${git(ws)} rev-parse HEAD`, { cwd: ws.root, timeoutMs: 10_000 })
    .catch(() => ({ stdout: "", code: 1 }));
  if (r.code !== 0) return null;
  const s = r.stdout.trim();
  return s.length >= 7 ? s : null;
}

/**
 * Repo-relative paths touched since `baseSha` (tracked edits plus untracked
 * files), capped at `limit`.
 */
export async function changedPaths(
  ws: Workspace,
  baseSha: string | null,
  limit = 200,
): Promise<string[]> {
  const base = baseSha && baseSha.length >= 7 ? baseSha : "HEAD";
  const cmd = [
    `${git(ws)} diff --name-only ${base} -- 2>/dev/null`,
    `${git(ws)} ls-files --others --exclude-standard 2>/dev/null`,
  ].join("; ");
  try {
    const r = await ws.exec(cmd, { cwd: ws.root, timeoutMs: 15_000 });
    const paths = r.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    return [...new Set(paths)].slice(0, limit);
  } catch {
    return [];
  }
}

/** True when the tree differs from `baseSha`, or from a clean tree when the base is unknown. */
export async function dirtyVsBase(ws: Workspace, baseSha: string | null): Promise<boolean> {
  if (!baseSha) {
    const st = await ws.exec(`${git(ws)} status --porcelain`, { cwd: ws.root, timeoutMs: 10_000 });
    return st.stdout.trim().length > 0;
  }
  const d = await ws.exec(`${git(ws)} diff --quiet ${baseSha} --`, {
    cwd: ws.root,
    timeoutMs: 20_000,
  });
  if (d.code !== 0) return true;
  const u = await ws.exec(`${git(ws)} ls-files --others --exclude-standard`, {
    cwd: ws.root,
    timeoutMs: 10_000,
  });
  return u.stdout.trim().length > 0;
}

/** Stable digest of the working tree relative to `baseSha`; any edit changes it. */
export async function fingerprint(ws: Workspace, baseSha: string | null): Promise<string> {
  const p = await ws.exec(`${git(ws)} status --porcelain`, { cwd: ws.root, timeoutMs: 10_000 });
  if (!baseSha) return p.stdout;
  const diff = await ws.exec(`${git(ws)} diff --shortstat ${baseSha} --`, {
    cwd: ws.root,
    timeoutMs: 20_000,
  });
  return `${p.stdout}\n${diff.stdout}`;
}

/** Paths whose deletion would let a run grade its own homework. */
export const VERIFICATION_PATH = /(^|\/)(tests?|spec|__tests__)(\/|$)|\.github\/workflows\//;

/** Test, spec, and workflow files deleted since `baseSha`. */
export async function deletedVerificationFiles(
  ws: Workspace,
  baseSha: string | null,
): Promise<string[]> {
  if (!baseSha) return [];
  const r = await ws
    .exec(`${git(ws)} diff --diff-filter=D --name-only ${baseSha} --`, {
      cwd: ws.root,
      timeoutMs: 20_000,
    })
    .catch(() => ({ stdout: "", code: 1 }));
  if (r.code !== 0) return [];
  return r.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((p) => p && VERIFICATION_PATH.test(p));
}
