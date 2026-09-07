# AGENTS.md

Instructions for coding agents working in this repository. Keep them; they are short on purpose.

- Run `pnpm check` (typecheck, tests, lint) after every change. Run the tests for one package with `pnpm --filter <name> test`.
- Keep `packages/core` dependency-free. `dependencies` in `packages/core/package.json` stays empty. Do not add a runtime dependency to any package without a linked issue.
- Prompt bytes are cache-sensitive. Do not make cosmetic edits to `packages/core/src/prompt.ts` or to the strings in `buildContinuePrompt` in `packages/core/src/loop.ts`. A changed byte invalidates every user's provider prefix cache and changes the benchmark.
- Never update `packages/opencode/test/__snapshots__/golden.test.ts.snap` to make a refactor pass. The golden test in `packages/opencode/test/golden.test.ts` is byte parity with the hosted product. If it fails, the change is a product change, not a refactor.
- Never edit anything under `evals/runs`. Those directories are published benchmark evidence.
- Do not write into a user's repository from harness code. `.mouse/` in a repo holds user-authored policy only; Mouse's own state goes under `~/.mouse/runs/`.
- Do not add telemetry, install pings, or update checks.
- No emojis in code, commits, issues, or pull requests. No em-dashes in prose.
- Commit messages use conventional prefixes (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`) and describe the change in the imperative.
