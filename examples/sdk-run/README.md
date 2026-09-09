# Example: drive the loop from your own code

`src/run.ts` is the whole CLI in forty lines: a workspace, a probe, an engine, and `runCompletionLoop`. Use it as the starting point for embedding Mouse in another tool, or for putting the loop on an engine other than OpenCode (anything that implements `Engine` from `@mousedev/harness-core` will do).

Run it from a repository you want worked on, with `opencode` installed and a provider configured:

```bash
pnpm install --frozen-lockfile --ignore-scripts      # once, at the repository root
cd /path/to/your-repo
MOUSE_MODEL=provider/model node --experimental-strip-types \
  /path/to/mouse-harness/examples/sdk-run/src/run.ts "Add a --json flag to the CLI"
```

It prints each check result and round as the loop runs, then the outcome, step count, and cost, and exits 0 when satisfied and 3 otherwise. The completion loop's behaviour is described in [docs/loop.md](../../docs/loop.md); the packages' APIs in [packages/core](../../packages/core/README.md) and [packages/opencode](../../packages/opencode/README.md).
