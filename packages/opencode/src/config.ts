/**
 * Mouse's OpenCode engine config.
 *
 * Mouse owns the engine configuration; the user owns the repo. Every mode is
 * an OpenCode agent carrying its own `permission` block, and agent-level
 * permission overrides global, so a read-only mode cannot edit a file even
 * if the model ignores the prompt.
 *
 * Profiles:
 * - `product`: the per-turn `config.update` delta a host pushes. Agents and
 *   the tools-off list only.
 * - `bench`: the complete file the headless harness writes: Mouse's prompt,
 *   compaction, cache keys, the run model as `small_model`, autoupdate off.
 *   Frozen; a byte change here is a benchmark change.
 * - `local`: what `mouse run` hands OpenCode through `OPENCODE_CONFIG_CONTENT`
 *   so nothing under `~/.config/opencode` is written. Same agents, prompt,
 *   tools-off list, and compaction as bench; no OpenRouter pin, no
 *   `small_model` override.
 */
import {
  buildAgentPrompt,
  type Mode,
  type PermissionAction,
  type PermissionsPolicy,
  type Profile,
  permissionRulesForTool,
} from "@mousedev/harness-core";
import type { Config } from "@opencode-ai/sdk";

/**
 * Providers whose OpenCode adapter takes a `setCacheKey` option. A provider
 * added for a benchmark gets cache keys everywhere.
 */
export const SET_CACHE_KEY_PROVIDER_IDS = ["anthropic", "openrouter", "fireworks-ai"] as const;

export function providerCacheOptions(
  extra: readonly string[] = [],
): Record<string, { options: { setCacheKey: boolean } }> {
  const out: Record<string, { options: { setCacheKey: boolean } }> = {};
  for (const id of [...SET_CACHE_KEY_PROVIDER_IDS, ...extra]) {
    out[id] = { options: { setCacheKey: true } };
  }
  return out;
}

/** Bench compaction: auto at the window, prune stale tool outputs, 10k reserve. */
export const BENCH_COMPACTION = { auto: true, prune: true, reserved: 10_000 } as const;

/**
 * OpenRouter request body pinning Kimi K3 to the backend FrontierHarness used.
 * An implicit prefix cache lives on one backend; a session that hops
 * providers between calls pays full price on every hop.
 */
export const OPENROUTER_PIN_FIREWORKS = {
  provider: { order: ["Fireworks"], allow_fallbacks: false },
} as const;

export interface ModePermission {
  edit: PermissionAction;
  bash: PermissionAction;
}

/**
 * Per-mode posture. `plan` keeps bash at `ask` because that is what
 * OpenCode's built-in plan agent does; plan-mode research legitimately
 * reaches for `git log`. `debug` may run shell freely but asks before edits.
 */
export const MODE_PERMISSIONS: Record<"ask" | "plan" | "debug" | "build", ModePermission> = {
  ask: { edit: "deny", bash: "deny" },
  plan: { edit: "deny", bash: "ask" },
  debug: { edit: "ask", bash: "allow" },
  build: { edit: "allow", bash: "allow" },
};

/**
 * OpenCode built-ins Mouse turns off. A host replaces them with metered,
 * event-emitting equivalents; the CLI keeps the run to the repo and the
 * model. Names a given OpenCode version does not define are ignored.
 */
export const DISABLED_TOOLS = ["webfetch", "websearch", "task", "skill"] as const;

export interface OpencodeConfigInput {
  /** `.mouse/policy.json -> permissions`, already parsed. */
  permissions?: PermissionsPolicy;
  /**
   * Effective permission mode. Only `bypass` widens anything, and only where
   * the mode already allowed writes.
   */
  permissionMode?: "interactive" | "auto" | "bypass";
  profile?: Profile;
  /** `provider/model` the run uses. Bench also makes it `small_model`. */
  model?: string;
  /** Model for cheap internal calls (titles). Ignored by `bench`, which uses `model`. */
  smallModel?: string;
  /**
   * Host-defined modes appended after the built-in four, in this order.
   * Prompts come from `buildAgentPrompt`, so a host mode named `overnight`
   * gets build's prompt.
   */
  extraModes?: Record<string, ModePermission>;
}

/**
 * Fold the user's `deny` globs for a tool into an OpenCode `permission.bash`
 * object, on top of the mode default.
 *
 * Only `deny` rules cross over, deliberately. Mouse's policy is documented as
 * first-match-wins; OpenCode's pattern matching is last-match-wins. Feeding
 * both allow and deny rules through would silently invert precedence when a
 * user writes overlapping patterns. Denies are safe under either reading.
 */
function bashPermission(
  base: PermissionAction,
  policy: PermissionsPolicy | undefined,
): PermissionAction | Record<string, PermissionAction> {
  const denies = policy
    ? permissionRulesForTool(policy.bash)
        .filter(([, action]) => action === "deny")
        .map(([pattern]) => pattern)
    : [];
  if (denies.length === 0) return base;
  // `*` first so it is the weakest rule under last-match-wins.
  const out: Record<string, PermissionAction> = { "*": base };
  for (const pattern of denies) out[pattern] = "deny";
  return out;
}

/** `bypass` only turns an `ask` into `allow`; a read-only mode stays read-only. */
function editPermission(
  base: PermissionAction,
  permissionMode: OpencodeConfigInput["permissionMode"],
): PermissionAction {
  if (permissionMode === "bypass" && base === "ask") return "allow";
  return base;
}

/**
 * Plan mode's one writable path: the plan file. OpenCode's `permission.edit`
 * accepts a glob map at runtime (last match wins) though the SDK type says
 * scalar, hence the cast.
 */
const PLAN_EDIT = {
  "*": "deny",
  ".mouse/plans/*.md": "allow",
} as Record<string, PermissionAction> as unknown as PermissionAction;

/** The OpenCode agent name Mouse selects for a mode. */
export function agentNameForMode(mode: Mode): string {
  return mode;
}

export function buildOpencodeConfig(input: OpencodeConfigInput): Config {
  const profile: Profile = input.profile ?? "product";
  const withPrompt = profile !== "product";
  const modes: Array<[string, ModePermission]> = [
    ...(Object.entries(MODE_PERMISSIONS) as Array<[string, ModePermission]>),
    ...Object.entries(input.extraModes ?? {}),
  ];
  const agent: NonNullable<Config["agent"]> = {};
  for (const [mode, posture] of modes) {
    const prompt = withPrompt ? buildAgentPrompt(mode, { profile }) : undefined;
    agent[agentNameForMode(mode)] = {
      mode: "primary",
      ...(prompt ? { prompt } : {}),
      permission: {
        edit: mode === "plan" ? PLAN_EDIT : editPermission(posture.edit, input.permissionMode),
        bash: bashPermission(posture.bash, input.permissions),
        // Native fetch is off; belt-and-braces alongside `tools.webfetch: false`.
        webfetch: "deny",
        // Hosts run their own doom-loop detector; OpenCode's would double-prompt.
        doom_loop: "allow",
      },
    };
  }

  const tools: Record<string, boolean> = {};
  for (const name of DISABLED_TOOLS) tools[name] = false;

  const config: Config = { agent, tools };

  const smallModel = input.smallModel?.trim();
  if (smallModel) config.small_model = smallModel;

  if (profile === "bench") {
    // The bench config is the whole file OpenCode reads, not a delta.
    // `compaction` is in the server schema but not the SDK's Config type.
    const bench = config as Config & Record<string, unknown>;
    bench.$schema = "https://opencode.ai/config.json";
    bench.autoupdate = false;
    bench.share = "disabled";
    bench.compaction = { ...BENCH_COMPACTION };
    const modelProvider = input.model?.includes("/") ? [input.model.split("/")[0]!] : [];
    const provider = providerCacheOptions(modelProvider) as Record<
      string,
      { options: Record<string, unknown> }
    >;
    if (modelProvider[0] === "openrouter") {
      provider.openrouter!.options.extraBody = OPENROUTER_PIN_FIREWORKS;
    }
    bench.provider = provider as Config["provider"];
    if (input.model) bench.small_model = input.model;
  } else if (profile === "local") {
    const local = config as Config & Record<string, unknown>;
    local.compaction = { ...BENCH_COMPACTION };
    const modelProvider = input.model?.includes("/") ? [input.model.split("/")[0]!] : [];
    local.provider = providerCacheOptions(modelProvider) as Config["provider"];
  }

  return config;
}

/**
 * Deep-merge `over` into `base`, objects only; arrays and scalars replace.
 * Used to layer Mouse's config over whatever a runner already registered.
 */
export function mergeConfig(
  base: Record<string, unknown>,
  over: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const prev = out[k];
    out[k] =
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      prev &&
      typeof prev === "object" &&
      !Array.isArray(prev)
        ? mergeConfig(prev as Record<string, unknown>, v as Record<string, unknown>)
        : v;
  }
  return out;
}
