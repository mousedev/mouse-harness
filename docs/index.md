# Mouse harness documentation

Mouse runs OpenCode in your repo and does not stop until the repo's own checks pass. These pages describe the released behaviour of version 0.1.0; where the code and a plan disagree, the code wins and the page says so.

## Using Mouse

- [Quickstart](quickstart.md): install, first run, reading the output.
- [The completion loop](loop.md): what happens after the first turn, the round kinds, and every stop condition.
- [Configuration](config.md): `.mouse/policy.json` field by field with defaults, CLI flags, environment variables, and how checks are detected.
- [Permissions policy](policy.md): the `permissions` block, first-match-wins, and what reaches OpenCode.
- [OpenCode compatibility](opencode-compat.md): the compat manifest, `mouse doctor`, `--strict-compat`.
- [Security](security.md): the trust boundary in one page; the full statement is [SECURITY.md](../SECURITY.md).

## Formats Mouse owns

- [The MOUSE_AUDIT protocol](audit-protocol.md): the block the model ends its reply with and how it is parsed.
- [The trace](trace.md): the JSONL record types under `~/.mouse/runs/`.

## Evaluation

- [Evals](evals.md): where the benchmark code lives and the rules for making claims; the runbook is [evals/README.md](../evals/README.md).

## Packages

- [`@mousedev/harness-core`](../packages/core/README.md)
- [`@mousedev/harness-opencode`](../packages/opencode/README.md)
- [`@mousedev/harness`](../packages/cli/README.md)

## Project

- [README](../README.md), [CONTRIBUTING](../CONTRIBUTING.md), [CHANGELOG](../CHANGELOG.md), [LICENSE](../LICENSE), [NOTICE](../NOTICE), [CITATION.cff](../CITATION.cff).

`docs.json` in this directory is the navigation manifest, in reading order, for anything that renders these pages.
