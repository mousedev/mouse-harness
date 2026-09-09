# Patches

Nothing here touches a task, a test, a verifier, or scoring. Both files are container-build plumbing for running the benchmark on Runta, kept for the record of the 2026-09-07 attempt.

| File | What it does |
|---|---|
| `frontierharness-eval-8f11b130.patch` | The diff we ran against [frontier-harness-eval/eval](https://github.com/frontier-harness-eval/eval) at commit `8f11b130`: egress and readiness fixes to their provisioning and trial scripts, a plain-runc Docker runtime on Runta, restore retries, apt retry settings, and the key stub. Most of it landed upstream in [eval#11](https://github.com/frontier-harness-eval/eval/pull/11); the published 2026-09-08 run used their scripts at `e837a70` unmodified, with the three allowlist hosts noted in [eval#12](https://github.com/frontier-harness-eval/eval/issues/12). |
| `pier-trust-patch.py` | Adds the Runta egress proxy's CA certificate and apt config to the Dockerfiles Pier generates, so `RUN` steps can fetch through the intercepting proxy at build time. `install-mouse.sh` applies it only when that CA file exists. |

The per-hunk explanation is in the "History" section of [evals/README.md](../../README.md).
