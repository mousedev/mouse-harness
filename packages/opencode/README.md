# @mousedev/harness-opencode

The OpenCode engine for the Mouse harness. It owns everything Mouse says to OpenCode: the agent configuration (one OpenCode agent per mode, each with its own permission block and Mouse's prompt), the `local` and `bench` config profiles, the `opencode run --format=json` transport that implements core's `Engine` interface, the compat manifest that records which OpenCode versions Mouse has been run against, the tool-output prune plugin, and the logic that locates the `opencode` binary. It depends on `@mousedev/harness-core` and on `@opencode-ai/sdk` (pinned to 1.14.22) for the `Config` type.

This is the package the hosted product consumes as well as the CLI, so its output is pinned byte for byte by `test/golden.test.ts`: the same profile, permission mode, and model must produce the same config, and the same round kind the same continue prompt. Never update that snapshot to make a refactor pass. Built on OpenCode; Mouse is an independent project and is not affiliated with or endorsed by the OpenCode project or Anomaly.

## Main API

```ts
import {
  buildOpencodeConfig, mergeConfig, MODE_PERMISSIONS, DISABLED_TOOLS,
  OpencodeRunEngine, locateOpencode, opencodeVersion,
  loadCompatManifest, checkCompat, parseOpencodeVersion,
  prunePluginSource, PRUNE_PLUGIN_FILENAME, MOUSE_VERSION, versionLine,
} from "@mousedev/harness-opencode";
```

- `buildOpencodeConfig({ profile, model, permissions, permissionMode?, smallModel?, extraModes? })` returns the OpenCode `Config`. `local` (what `mouse run` sends through `OPENCODE_CONFIG_CONTENT`) carries the agents, Mouse's prompt, the tools-off list, compaction, and cache keys for the model's provider. `bench` is the complete file the benchmark writes: the same plus `$schema`, `autoupdate: false`, `share: "disabled"`, `small_model` set to the run model, and OpenRouter pinned to Fireworks. `product` is the delta a host pushes (agents and tools only). Only the `bash` deny patterns from `permissions` cross into the config; [docs/policy.md](../../docs/policy.md) explains why.
- `mergeConfig(base, over)` deep-merges objects (arrays and scalars replace), used to layer the bench config over a runner's existing `opencode.json`.
- `new OpencodeRunEngine({ cwd, model, bin?, agent?, env?, idleTimeoutMs?, maxAttempts?, skipPermissions?, passthrough?, passthroughErr?, trace?, extraArgs? })` spawns one `opencode run` per `prompt()` call, continues the session with `--session`, passes every stdout line through unchanged, counts steps and tokens, retries turns that produced no steps with backoff, and kills a turn that goes idle. `argsFor(prompt)` shows the argv.
- `locateOpencode({ flag?, env?, cwd? })` resolves the binary (flag, `MOUSE_OPENCODE_BIN`, `PATH`, nearest `node_modules/.bin/opencode`); `opencodeVersion(bin)` runs `--version`.
- `checkCompat(versionOutput)` returns `supported`, `untested`, or `unknown` against `compat/opencode-compat.json` ([docs/opencode-compat.md](../../docs/opencode-compat.md)).
- `prunePluginSource(policy.context.prune)` is the plugin source the CLI writes when pruning is enabled.
- `versionLine(opencodeVersion)` is `mouse/<version> opencode/<version>`, the line benchmark runners record.

Requires Node 22 or newer. MIT.
