# Example: one Terminal-Bench task through Harbor

Runs Mouse the way the benchmark runs it: Harbor spins up the task container, installs OpenCode and the Mouse bundle inside it, and grades the result with the task's own verifier.

```bash
uv tool install harbor==0.22.0
pnpm bundle                                        # -> packages/cli/dist/mouse.mjs
harbor tasks download terminal-bench/regex-log -o evals/tasks
set -a; source evals/.env; set +a                  # FIREWORKS_API_KEY or OPENROUTER_API_KEY
PYTHONPATH=. harbor run -p evals/tasks/regex-log \
  --agent evals.harbor.mouse_agent:MouseAgent \
  --model openrouter/moonshotai/kimi-k3 --jobs-dir evals/jobs -y
python3 evals/report.py evals/jobs
```

`evals/README.md` covers the full 30-task set, the Runta path FrontierHarness uses, and the control run with stock OpenCode.
