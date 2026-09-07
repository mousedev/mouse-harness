# Changelog

All notable changes to this project are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/). The three packages (`@mousedev/harness-core`, `@mousedev/harness-opencode`, `@mousedev/harness`) share one version and are released together.

This file is maintained by the maintainers. Contributors do not need to edit it in pull requests.

## [Unreleased]

## [0.1.0] - 2026-09-07

### Added

- Initial extraction of the Mouse harness from the hosted product into three packages: the completion loop, the MEA audit primitives, the agent prompt, ecosystem detection (package.json scripts, pytest, go test, cargo test, make test), `.mouse/policy.json` parsing with defaults, and the versioned JSONL trace (`@mousedev/harness-core`).
- OpenCode run engine over `opencode run --format=json` with an idle watchdog and bounded retries for empty turns, plus the `local` and `bench` config profiles, the compat manifest, the tool-output prune plugin, and binary location (`@mousedev/harness-opencode`).
- The `mouse` CLI with `run`, `config`, `init`, `doctor`, and `--version`, and exit codes that encode the run outcome (`@mousedev/harness`).
- Harbor and Pier agent adapters (`evals/harbor`, `evals/pier`) and the shared `evals.fh:MouseAgent` import path, with `evals/report.py` for reading a job directory.
- FrontierHarness runbook for the Runta workflow (`evals/frontierharness`): provisioning, smoke, trials, retry, and scoring, with `fill_trials.py` to fill trial records from the runners' results.

[Unreleased]: https://github.com/mousedev/mouse-harness/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/mousedev/mouse-harness/releases/tag/v0.1.0
