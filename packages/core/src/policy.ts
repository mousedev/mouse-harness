/**
 * `.mouse/policy.json`: the only thing Mouse reads from a repo.
 *
 * Hand-rolled parsing with defaults, no schema library, so `core` stays
 * dependency-free. Unknown keys are preserved on `extra` and ignored, which
 * keeps the file forward-compatible with hosts that add blocks of their own.
 */
import type { DetectedCheck } from "./detect.js";
import type { Workspace } from "./workspace.js";
import { shellPath } from "./workspace.js";

export type PermissionAction = "allow" | "ask" | "deny";
/** Either a single action for every call, or a pattern -> action map. */
export type PermissionToolEntry = PermissionAction | Record<string, PermissionAction>;

export interface PermissionsPolicy {
  bash?: PermissionToolEntry;
  write?: PermissionToolEntry;
  edit?: PermissionToolEntry;
  doom_loop?: PermissionAction;
}

export interface VerifyPolicy {
  /** Explicit checks; `null` means detect them from the repo's manifests. */
  checks: DetectedCheck[] | null;
  /** Per-check wall clock. */
  timeoutSec: number;
}

export interface LoopPolicy {
  maxWallSec: number;
  maxSteps: number;
  nonProgressRounds: number;
  idleTimeoutSec: number;
  minRoundSec: number;
}

export interface PrunePolicy {
  enabled: boolean;
  thresholdChars: number;
  headChars: number;
  tailChars: number;
}

export interface Policy {
  version: 1;
  verify: VerifyPolicy;
  loop: LoopPolicy;
  context: { prune: PrunePolicy };
  permissions: PermissionsPolicy;
  /** Top-level keys this version does not know, kept verbatim. */
  extra: Record<string, unknown>;
}

export const DEFAULT_POLICY: Policy = {
  version: 1,
  verify: { checks: null, timeoutSec: 900 },
  loop: {
    maxWallSec: 780,
    maxSteps: 600,
    nonProgressRounds: 3,
    idleTimeoutSec: 600,
    minRoundSec: 60,
  },
  context: { prune: { enabled: false, thresholdChars: 8192, headChars: 4096, tailChars: 1024 } },
  permissions: {},
  extra: {},
};

const KNOWN_KEYS = new Set(["version", "verify", "loop", "context", "permissions"]);
const ACTIONS: ReadonlySet<string> = new Set(["allow", "ask", "deny"]);

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function int(v: unknown, fallback: number, min = 1, max = Number.MAX_SAFE_INTEGER): number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

/**
 * `verify.checks` accepts the array form `[{name, command}]` and the object
 * form `{ "test": "pnpm test" }` from `.mouse/app.json`.
 */
export function parseChecks(v: unknown): DetectedCheck[] | null {
  if (Array.isArray(v)) {
    const out: DetectedCheck[] = [];
    for (const item of v) {
      const o = obj(item);
      if (o && typeof o.name === "string" && typeof o.command === "string" && o.command.trim()) {
        out.push({ name: o.name, command: o.command });
      }
    }
    return out;
  }
  const o = obj(v);
  if (!o) return null;
  const out: DetectedCheck[] = [];
  for (const [name, command] of Object.entries(o)) {
    if (typeof command === "string" && command.trim()) out.push({ name, command });
  }
  return out;
}

function parseToolEntry(v: unknown): PermissionToolEntry | undefined {
  if (typeof v === "string") return ACTIONS.has(v) ? (v as PermissionAction) : undefined;
  const o = obj(v);
  if (!o) return undefined;
  const out: Record<string, PermissionAction> = {};
  for (const [pattern, action] of Object.entries(o)) {
    if (typeof action === "string" && ACTIONS.has(action))
      out[pattern] = action as PermissionAction;
  }
  return out;
}

export function parsePermissions(v: unknown): PermissionsPolicy {
  const o = obj(v);
  if (!o) return {};
  const out: PermissionsPolicy = {};
  for (const tool of ["bash", "write", "edit"] as const) {
    const entry = parseToolEntry(o[tool]);
    if (entry !== undefined) out[tool] = entry;
  }
  if (typeof o.doom_loop === "string" && ACTIONS.has(o.doom_loop)) {
    out.doom_loop = o.doom_loop as PermissionAction;
  }
  return out;
}

/** Parse a policy document leniently: every block optional, every field defaulted. */
export function parsePolicy(raw: unknown): Policy {
  const o = obj(raw) ?? {};
  const d = DEFAULT_POLICY;
  const verify = obj(o.verify) ?? {};
  const loop = obj(o.loop) ?? {};
  const prune = obj(obj(o.context)?.prune) ?? {};
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (!KNOWN_KEYS.has(k)) extra[k] = v;
  return {
    version: 1,
    verify: {
      checks: "checks" in verify ? parseChecks(verify.checks) : d.verify.checks,
      timeoutSec: int(verify.timeoutSec, d.verify.timeoutSec, 1, 86_400),
    },
    loop: {
      maxWallSec: int(loop.maxWallSec, d.loop.maxWallSec),
      maxSteps: int(loop.maxSteps, d.loop.maxSteps),
      nonProgressRounds: int(loop.nonProgressRounds, d.loop.nonProgressRounds),
      idleTimeoutSec: int(loop.idleTimeoutSec, d.loop.idleTimeoutSec),
      minRoundSec: int(loop.minRoundSec, d.loop.minRoundSec, 0),
    },
    context: {
      prune: {
        enabled: bool(prune.enabled, d.context.prune.enabled),
        thresholdChars: int(prune.thresholdChars, d.context.prune.thresholdChars),
        headChars: int(prune.headChars, d.context.prune.headChars, 0),
        tailChars: int(prune.tailChars, d.context.prune.tailChars, 0),
      },
    },
    permissions: parsePermissions(o.permissions),
    extra,
  };
}

/**
 * Decode a single tool entry into an ordered list of `[pattern, action]`
 * tuples. A single-action entry is normalized to `[["*", action]]`. Callers
 * walk the list in order: first match wins. Object iteration order matches
 * JSON declaration order, which is the contract users sign up for when they
 * hand-edit policy.json.
 */
export function permissionRulesForTool(
  entry: PermissionToolEntry | undefined,
): Array<[pattern: string, action: PermissionAction]> {
  if (!entry) return [];
  if (typeof entry === "string") return [["*", entry]];
  return Object.entries(entry);
}

/** Read one file out of the workspace, or null when it is missing or unreadable. */
export async function readWorkspaceFile(ws: Workspace, relPath: string): Promise<string | null> {
  if (relPath.includes("..") || relPath.startsWith("/")) return null;
  const abs = `${ws.root.replace(/\/+$/, "")}/${relPath}`;
  try {
    const res = await ws.exec(`test -f ${shellPath(abs)} && cat ${shellPath(abs)} || true`, {
      cwd: ws.root,
      timeoutMs: 5000,
    });
    if (res.code !== 0) return null;
    return res.stdout || null;
  } catch {
    return null;
  }
}

function parseJson(raw: string | null): Record<string, unknown> | null {
  if (!raw?.trim()) return null;
  try {
    return obj(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Load `.mouse/policy.json`. When it has no `verify` block, `.mouse/app.json`'s
 * `verify.checks` is read as an alias so repos written for the hosted product
 * keep their declared checks.
 */
export async function loadPolicy(ws: Workspace): Promise<Policy> {
  const raw = parseJson(await readWorkspaceFile(ws, ".mouse/policy.json")) ?? {};
  if (!obj(raw.verify)) {
    const app = parseJson(await readWorkspaceFile(ws, ".mouse/app.json"));
    const verify = obj(app?.verify);
    if (verify) {
      const alias: Record<string, unknown> = {};
      if ("checks" in verify) alias.checks = verify.checks;
      if (typeof verify.timeoutSec === "number") alias.timeoutSec = verify.timeoutSec;
      raw.verify = alias;
    }
  }
  return parsePolicy(raw);
}
