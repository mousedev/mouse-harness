import { buildAgentPrompt } from "@mousedev/harness-core";
import { describe, expect, it } from "vitest";
import {
  agentNameForMode,
  BENCH_COMPACTION,
  buildOpencodeConfig,
  mergeConfig,
  SET_CACHE_KEY_PROVIDER_IDS,
} from "../src/config.js";

const ALL_MODES = ["ask", "plan", "debug", "build"] as const;

function permissionFor(mode: string, config = buildOpencodeConfig({})) {
  const agent = config.agent?.[agentNameForMode(mode)];
  if (!agent?.permission) throw new Error(`no permission block for ${mode}`);
  return agent.permission;
}

describe("buildOpencodeConfig bench profile", () => {
  const model = "fireworks-ai/accounts/fireworks/models/kimi-k3";
  const bench = buildOpencodeConfig({ profile: "bench", model }) as Record<string, unknown>;

  it("product output carries no bench-only keys", () => {
    const product = buildOpencodeConfig({}) as Record<string, unknown>;
    expect(product.compaction).toBeUndefined();
    expect(product.provider).toBeUndefined();
    expect(product.autoupdate).toBeUndefined();
    const build = (product.agent as Record<string, Record<string, unknown>>).build;
    expect(build?.prompt).toBeUndefined();
  });

  it("replaces the engine prompt with Mouse's for the writing modes only", () => {
    const agents = bench.agent as Record<string, Record<string, unknown>>;
    expect(agents.build?.prompt).toBe(buildAgentPrompt("build"));
    expect(agents.ask?.prompt).toBeUndefined();
    expect(agents.plan?.prompt).toBeUndefined();
  });

  it("is a complete engine config: compaction, cache keys, run model, no autoupdate", () => {
    expect(bench.compaction).toEqual(BENCH_COMPACTION);
    expect(bench.autoupdate).toBe(false);
    expect(bench.share).toBe("disabled");
    expect(bench.small_model).toBe(model);
    const provider = bench.provider as Record<string, { options: { setCacheKey: boolean } }>;
    for (const id of SET_CACHE_KEY_PROVIDER_IDS.filter((x) => x !== "fireworks-ai")) {
      expect(provider[id]?.options.setCacheKey).toBe(true);
    }
    // The run model is served by Fireworks here, so its entry is dropped (see below).
    expect(provider["fireworks-ai"]).toBeUndefined();
  });

  it("sends no cache key to Fireworks when it serves the run, and keeps the inert entry otherwise", () => {
    const fw = buildOpencodeConfig({ profile: "bench", model }) as Record<string, unknown>;
    expect((fw.provider as Record<string, unknown>)["fireworks-ai"]).toBeUndefined();
    expect((fw.provider as Record<string, unknown>).openrouter).toBeDefined();
    const or = buildOpencodeConfig({
      profile: "bench",
      model: "openrouter/moonshotai/kimi-k3",
    }) as Record<string, unknown>;
    expect(
      (or.provider as Record<string, { options: { setCacheKey: boolean } }>)["fireworks-ai"]
        ?.options.setCacheKey,
    ).toBe(true);
  });

  it("adds cache keys for the run model's provider even when it is not in the list", () => {
    const c = buildOpencodeConfig({ profile: "bench", model: "moonshotai/kimi-k3" }) as Record<
      string,
      unknown
    >;
    const provider = c.provider as Record<string, { options: { setCacheKey: boolean } }>;
    expect(provider.moonshotai?.options.setCacheKey).toBe(true);
  });

  it("pins OpenRouter to Fireworks so the session stays on one prefix cache", () => {
    const c = buildOpencodeConfig({
      profile: "bench",
      model: "openrouter/moonshotai/kimi-k3",
    }) as Record<string, unknown>;
    const provider = c.provider as Record<string, { options: Record<string, unknown> }>;
    expect(provider.openrouter?.options.extraBody).toEqual({
      provider: { order: ["Fireworks"], allow_fallbacks: false },
    });
    expect(provider["fireworks-ai"]?.options.extraBody).toBeUndefined();
  });

  it("keeps the duplicated built-ins off", () => {
    expect(bench.tools).toMatchObject({
      webfetch: false,
      websearch: false,
      task: false,
      skill: false,
    });
  });
});

describe("buildOpencodeConfig local profile", () => {
  const local = buildOpencodeConfig({
    profile: "local",
    model: "openrouter/moonshotai/kimi-k3",
  }) as Record<string, unknown>;

  it("has the prompt, compaction, and cache keys but no file-level or bench-only keys", () => {
    const agents = local.agent as Record<string, Record<string, unknown>>;
    expect(agents.build?.prompt).toBe(buildAgentPrompt("build"));
    expect(local.compaction).toEqual(BENCH_COMPACTION);
    expect(local.$schema).toBeUndefined();
    expect(local.autoupdate).toBeUndefined();
    expect(local.small_model).toBeUndefined();
    const provider = local.provider as Record<string, { options: Record<string, unknown> }>;
    expect(provider.openrouter?.options.setCacheKey).toBe(true);
    expect(provider.openrouter?.options.extraBody).toBeUndefined();
  });

  it("takes an explicit small model", () => {
    const c = buildOpencodeConfig({ profile: "local", smallModel: "anthropic/claude-haiku-4-5" });
    expect(c.small_model).toBe("anthropic/claude-haiku-4-5");
  });
});

describe("buildOpencodeConfig permissions", () => {
  it("defines an agent for every built-in mode and appends host modes in order", () => {
    const config = buildOpencodeConfig({
      extraModes: { overnight: { edit: "allow", bash: "allow" } },
    });
    expect(Object.keys(config.agent ?? {})).toEqual([...ALL_MODES, "overnight"]);
  });

  it("denies edits structurally in ask and allows them in build", () => {
    expect(permissionFor("ask").edit).toBe("deny");
    expect(permissionFor("build").edit).toBe("allow");
  });

  it("lets plan write exactly .mouse/plans/*.md, even under bypass", () => {
    expect(permissionFor("plan").edit).toEqual({ "*": "deny", ".mouse/plans/*.md": "allow" });
    expect(permissionFor("plan", buildOpencodeConfig({ permissionMode: "bypass" })).edit).toEqual({
      "*": "deny",
      ".mouse/plans/*.md": "allow",
    });
  });

  it("debug runs shell without prompting; plan keeps shell at ask; ask denies", () => {
    expect(permissionFor("debug").bash).toBe("allow");
    expect(permissionFor("plan").bash).toBe("ask");
    expect(permissionFor("ask").bash).toBe("deny");
  });

  it("denies native webfetch per agent and globally, leaves doom-loop to the host", () => {
    for (const mode of ALL_MODES) {
      expect(permissionFor(mode).webfetch).toBe("deny");
      expect(permissionFor(mode).doom_loop).toBe("allow");
    }
    expect(buildOpencodeConfig({}).tools?.webfetch).toBe(false);
  });

  describe("user policy deny globs", () => {
    const config = buildOpencodeConfig({
      permissions: { bash: { "pnpm test*": "allow", "curl *": "deny" } },
    });

    it("folds deny patterns into permission.bash on top of the mode default", () => {
      expect(permissionFor("build", config).bash).toEqual({ "*": "allow", "curl *": "deny" });
    });

    it("does not pass user allow globs to the engine", () => {
      const bash = permissionFor("build", config).bash as Record<string, string>;
      expect(bash["pnpm test*"]).toBeUndefined();
    });

    it("keeps a bare action when the user set no deny globs", () => {
      const plain = buildOpencodeConfig({ permissions: { bash: { "pnpm test*": "allow" } } });
      expect(permissionFor("build", plain).bash).toBe("allow");
    });
  });

  describe("bypass permission mode", () => {
    const bypassed = buildOpencodeConfig({ permissionMode: "bypass" });
    it("widens an ask to allow where the mode already permitted writes", () => {
      expect(permissionFor("debug", bypassed).edit).toBe("allow");
    });
    it("cannot turn a read-only mode into a writing one", () => {
      expect(permissionFor("ask", bypassed).edit).toBe("deny");
      expect(permissionFor("ask", bypassed).bash).toBe("deny");
    });
  });
});

describe("mergeConfig", () => {
  it("deep-merges objects and replaces arrays and scalars", () => {
    expect(mergeConfig({ a: { x: 1, y: [1] }, b: 1 }, { a: { y: [2], z: 3 }, b: 2 })).toEqual({
      a: { x: 1, y: [2], z: 3 },
      b: 2,
    });
  });
});
