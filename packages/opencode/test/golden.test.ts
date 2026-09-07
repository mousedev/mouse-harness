/**
 * Byte parity with the hosted product.
 *
 * `__snapshots__/golden.test.ts.snap` is copied verbatim from the private
 * relay's golden test (apps/relay/src/providers/mouse_cloud/harness/golden.test.ts,
 * landed 2026-09-04). The relay's `buildMouseOpencodeConfig` is this package's
 * `buildOpencodeConfig` plus its two host modes; every case here must match the
 * relay's output byte for byte or the relay cannot switch to these packages.
 *
 * Never update this snapshot to make a refactor pass. A changed byte in the
 * config or a prompt is a product change and a prompt-cache invalidation.
 */
import {
  buildAgentPrompt,
  buildContinuePrompt,
  type CheckResult,
  type ContinueKind,
  DETECT_ECOSYSTEM_COMMAND,
  initTaskState,
} from "@mousedev/harness-core";
import { describe, expect, it } from "vitest";
import {
  buildOpencodeConfig,
  type ModePermission,
  type OpencodeConfigInput,
} from "../src/config.js";

/** The relay's two extra modes, in the order it declares them. */
const RELAY_EXTRA_MODES: Record<string, ModePermission> = {
  overnight: { edit: "allow", bash: "allow" },
  dream: { edit: "deny", bash: "deny" },
};

const MODES = ["ask", "plan", "debug", "build", "overnight", "dream"];
const PERMISSION_MODES: NonNullable<OpencodeConfigInput["permissionMode"]>[] = [
  "interactive",
  "auto",
  "bypass",
];
const MODELS = [
  undefined,
  "fireworks-ai/accounts/fireworks/models/kimi-k3",
  "openrouter/moonshotai/kimi-k3",
  "anthropic/claude-sonnet-5",
];
const DENY_POLICY = { bash: { "git push*": "deny", "rm -rf*": "deny" } } as const;

/** What the relay's `buildMouseOpencodeConfig` becomes after the switch. */
function relayConfig(input: OpencodeConfigInput) {
  return buildOpencodeConfig({
    ...input,
    extraModes: RELAY_EXTRA_MODES,
    smallModel: process.env.MOUSE_OPENCODE_SMALL_MODEL?.trim(),
  });
}

describe("golden: buildMouseOpencodeConfig", () => {
  for (const profile of ["product", "bench"] as const) {
    for (const permissionMode of PERMISSION_MODES) {
      for (const model of MODELS) {
        it(`${profile} / ${permissionMode} / ${model ?? "no model"}`, () => {
          expect(relayConfig({ profile, permissionMode, model })).toMatchSnapshot();
        });
      }
    }
  }

  it("product with a user bash deny list", () => {
    expect(
      relayConfig({ permissions: DENY_POLICY, permissionMode: "interactive" }),
    ).toMatchSnapshot();
  });
});

describe("golden: prompts", () => {
  const instruction = `Add a \`data\` keyword to State.

- On entry, data initializes from the defaults.
- get_state_data(state) returns the active dict.
- Data survives pickle.`;
  const failed: CheckResult[] = [
    {
      name: "test",
      command: "pnpm test",
      pass: false,
      exitCode: 1,
      excerpt: "FAILED tests/test_x.py::test_y - assert 1 == 2",
    },
    { name: "typecheck", command: "pnpm typecheck", pass: false, exitCode: null, excerpt: "" },
  ];

  for (const kind of ["fix", "nochange", "audit"] as ContinueKind[]) {
    it(`buildContinuePrompt(${kind})`, () => {
      expect(
        buildContinuePrompt(kind, {
          instruction,
          state: initTaskState(instruction),
          failed: kind === "fix" ? failed : [],
          audit: kind === "audit" ? { done: ["entry defaults"], todo: ["pickle survival"] } : null,
        }),
      ).toMatchSnapshot();
    });
  }

  for (const mode of MODES) {
    it(`buildAgentPrompt(${mode})`, () => {
      expect(buildAgentPrompt(mode, { profile: "bench" })).toMatchSnapshot();
    });
  }

  it("DETECT_ECOSYSTEM_COMMAND", () => {
    expect(DETECT_ECOSYSTEM_COMMAND).toMatchSnapshot();
  });
});
