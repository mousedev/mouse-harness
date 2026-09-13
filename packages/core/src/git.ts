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

/**
 * Paths whose deletion would let a run grade its own homework: test
 * directories and workflows, co-located test files (`foo.test.ts`,
 * `x_test.go`, `test_x.py`, `conftest.py`), and the configuration the
 * checks are detected from (see `detect.ts`) or run by.
 */
export const VERIFICATION_PATH = new RegExp(
  [
    /(^|\/)(tests?|spec|__tests__)(\/|$)/.source,
    /\.github\/workflows\//.source,
    /\.(test|spec)\.[cm]?[jt]sx?$/.source,
    /_test\.go$/.source,
    /(^|\/)test_[^/]*\.py$/.source,
    /(^|\/)conftest\.py$/.source,
    /(^|\/)(vitest|jest|playwright)\.config\.[cm]?[jt]s$/.source,
    /(^|\/)(pytest\.ini|tox\.ini|setup\.cfg|pyproject\.toml|go\.mod|Cargo\.toml|Makefile)$/.source,
  ].join("|"),
);

/** Test, spec, workflow, and check-configuration files deleted since `baseSha`. */
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
