# Changelog

All notable changes to this project are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/). The three packages (`@mousedev/harness-core`, `@mousedev/harness-opencode`, `@mousedev/harness`) share one version and are released together.

This file is maintained by the maintainers. Contributors do not need to edit it in pull requests.

## [Unreleased]

### Added

- `checksRun` on every `mouse.round` and on the `mouse.done` trace record: the names of the checks the probe ran, so a trace shows whether an outcome rests on passing checks or on the workspace change and the model's audit alone.
- `locateOpencode` resolves `PATHEXT` on Windows, where npm installs `opencode.cmd`.
- Issue templates, `CODEOWNERS`, `SUPPORT.md`, `CODE_OF_CONDUCT.md`, `.editorconfig`, `.nvmrc`, and Dependabot for the pinned actions.

### Changed

- The benchmark section of the README, `docs/evals.md`, and the compat manifest describe the 2026-09-08 run under FrontierHarness's unmodified scripts (25/30) and keep the 2026-09-03 self-run (24/30) as history.
- `auditFromSandboxProbe` takes `workspaceChanged` instead of `hasNewCommit`, `headSha`, and `testExitCode`; the recorded facts say what the probe measured. `CompletionProbe` no longer has `headSha`.
- `MOUSE_VERSION` lives in `@mousedev/harness-core`; `versionLine` stays in the OpenCode adapter.
- The bench profile refuses to overwrite an `opencode.json` it cannot parse instead of replacing it with `{}`.
- `mouse run` removes its temp marker at exit; `--max-steps 5abc` is rejected instead of read as 5.

### Removed

- The unused manager half of `mea.ts` (`manageNext`, `initialContract`, `formatContractPrompt`, `formatTaskState`, `auditFromHardGates`, `parseTaskStateJson`, `taskStateSatisfied`, `pendingRequirements`) and the unused `detectPackageManager`, `changedPaths`, `dirtyVsBase`, and `LocalWorkspace.execFile`.
- The live-run status page and the Runta incident report from `evals/frontierharness/`; the run's own `NOTES.md` carries the incident record.

## [0.1.0] - 2026-09-07

### Added

- Initial extraction of the Mouse harness from the hosted product into three packages: the completion loop, the MEA audit primitives, the agent prompt, ecosystem detection (package.json scripts, pytest, go test, cargo test, make test), `.mouse/policy.json` parsing with defaults, and the versioned JSONL trace (`@mousedev/harness-core`).
- OpenCode run engine over `opencode run --format=json` with an idle watchdog and bounded retries for empty turns, plus the `local` and `bench` config profiles, the compat manifest, the tool-output prune plugin, and binary location (`@mousedev/harness-opencode`).
- The `mouse` CLI with `run`, `config`, `init`, `doctor`, and `--version`, and exit codes that encode the run outcome (`@mousedev/harness`).
- Harbor and Pier agent adapters (`evals/harbor`, `evals/pier`) and the shared `evals.fh:MouseAgent` import path, with `evals/report.py` for reading a job directory.
- FrontierHarness runbook for the Runta workflow (`evals/frontierharness`): provisioning, smoke, trials, retry, and scoring, with `fill_trials.py` to fill trial records from the runners' results.

[Unreleased]: https://github.com/mousedev/mouse-harness/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/mousedev/mouse-harness/releases/tag/v0.1.0
