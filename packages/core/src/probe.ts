/**
 * Workspace probe for a checkout. Prefers git for the fingerprint and tamper
 * scan; a directory that is not a repo falls back to "files newer than the
 * marker written before the first turn".
 */
import { checksFromEcosystem, type DetectedCheck, detectEcosystem } from "./detect.js";
import { LOCAL_EXEC_TIMEOUT_CODE } from "./exec.js";
import { deletedVerificationFiles, fingerprint as gitFingerprint } from "./git.js";
import { type CheckResult, type CompletionProbe, EXCERPT_MAX_CHARS } from "./loop.js";
import { shellPath, type Workspace } from "./workspace.js";

export interface ProbeOptions {
  workspace: Workspace;
  /** HEAD before the first turn; `null` when the directory is not a repo. */
  runStartSha: string | null;
  /** A file touched before the first turn, for the non-git fallback. */
  marker: string;
  signal: AbortSignal;
  /** Declared checks; `null` or `undefined` detects them from the manifests. */
  checks?: DetectedCheck[] | null;
  checkTimeoutMs?: number;
}

const DEFAULT_CHECK_TIMEOUT_MS = 900_000;
/** Ceiling on the non-git fallback listing; a larger tree still fingerprints, just coarsely. */
const FALLBACK_LIST_MAX = 2_000;
const FALLBACK_LIST_TIMEOUT_MS = 20_000;

export function makeProbe(o: ProbeOptions): CompletionProbe {
  const ws = o.workspace;
  const timeoutMs = o.checkTimeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS;
  let checksCache: DetectedCheck[] | null = o.checks ?? null;
  async function detected(): Promise<DetectedCheck[]> {
    if (checksCache) return checksCache;
    checksCache = checksFromEcosystem(await detectEcosystem(ws));
    return checksCache;
  }
  return {
    async checks(): Promise<CheckResult[]> {
      const out: CheckResult[] = [];
      for (const check of await detected()) {
        if (o.signal.aborted) break;
        const res = await ws
          .exec(check.command, { cwd: ws.root, timeoutMs, signal: o.signal })
          .catch((e) => ({ stdout: "", stderr: String(e), code: 1 }));
        out.push({
          ...check,
          pass: res.code === 0,
          exitCode: res.code === LOCAL_EXEC_TIMEOUT_CODE ? null : res.code,
          excerpt: `${res.stdout}\n${res.stderr}`.trim().slice(-EXCERPT_MAX_CHARS),
        });
      }
      return out;
    },
    tampering: () => deletedVerificationFiles(ws, o.runStartSha),
    async fingerprint(): Promise<string> {
      if (o.runStartSha) {
        const fp = await gitFingerprint(ws, o.runStartSha).catch(() => null);
        if (fp !== null) return fp;
      }
      const r = await ws.exec(
        `find ${shellPath(ws.root)} -xdev -type f -newer ${shellPath(o.marker)} -not -path '*/.git/*' -not -path '*/node_modules/*' 2>/dev/null | sort | head -${FALLBACK_LIST_MAX}`,
        { cwd: ws.root, timeoutMs: FALLBACK_LIST_TIMEOUT_MS },
      );
      return r.stdout;
    },
  };
}
