# Contributing

Thanks for looking at Mouse. This page is short because the rules are few and they matter.

## Before you write code

- Small fixes (a typo, a broken link, an obvious bug with a test) can go straight to a pull request.
- Anything larger starts with an issue: a new flag, a new policy key, a change to the loop, a new dependency, a change to how the CLI talks to OpenCode. Say what you want to change and why; wait for a maintainer to agree on the shape before spending time on it. This avoids pull requests that cannot be merged because they move the project somewhere it is not going. The [scope section of the README](README.md#what-mouse-is-and-is-not) lists what Mouse deliberately does not do; those are not open for reconsideration through a pull request.
- You must understand your code. If you used a coding agent to write it, that is fine; you still need to be able to explain every line in review. Pull requests whose author cannot answer questions about them are closed.

## Setup

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm check          # typecheck, tests, lint
pnpm bundle         # packages/cli/dist/mouse.mjs
```

Node 22 or newer. Tests run per package with vitest (`pnpm --filter @mousedev/harness-core test`). Lint and format are Biome (`pnpm lint`, `pnpm format`). Run `pnpm check` before you push; it is what CI runs.

## Rules

- **No new runtime dependencies in `packages/core` without a linked issue.** Core has zero dependencies and is meant to stay readable end to end. The same issue-first rule applies to dependencies in the other packages; exact-pinned versions only (`.npmrc` sets `save-exact`).
- **Tests for loop and prompt changes.** Anything in `packages/core/src/loop.ts`, `mea.ts`, `prompt.ts`, `policy.ts`, or `detect.ts` changes with a test in the matching `packages/core/test/*.test.ts`.
- **A prompt change includes a before/after smoke-eval note.** Prompt bytes are cache-sensitive and benchmark-sensitive. If you change `prompt.ts` or the continue prompts in `loop.ts`, the pull request description states what you ran before and after (task, model, outcome, steps, cost) so the maintainer can judge the delta. Cosmetic prompt edits (whitespace, wording with no behavioural intent) are not accepted.
- **Do not update the golden snapshot to make a refactor pass.** `packages/opencode/test/golden.test.ts` pins byte parity with the hosted product. A failing golden test means the change alters the config or a prompt; say so in the pull request and let a maintainer decide.
- **Never edit `evals/runs`.** Published benchmark evidence is append-only and written by the eval workflow.
- **Conventional commit prefixes.** `feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`, `perf:`. One change per commit where you can. No emojis in commits, issues, or pull requests.
- **The changelog is maintained by maintainers.** Do not edit `CHANGELOG.md` in a pull request; the maintainer adds the entry under `[Unreleased]` when merging.

## What a good pull request looks like

- Links the issue it implements (unless it is a small fix).
- Explains the change in the description, not only in the diff.
- Passes `pnpm check`.
- Adds or updates a test when behaviour changes.
- Updates the matching page under `docs/` when a flag, policy key, trace record, or exit code changes.

## Legal

No DCO sign-off and no CLA. By submitting a pull request you agree that your contribution is licensed under the MIT License in [LICENSE](LICENSE), the same terms as the rest of the project.

## Security

Do not report security issues in public issues. See [SECURITY.md](SECURITY.md).
