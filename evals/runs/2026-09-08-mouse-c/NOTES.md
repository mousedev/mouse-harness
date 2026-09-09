## 2026-09-09 02:05Z: Fireworks account suspended mid-run

Fireworks returned HTTP 412 "Account ... is suspended, possibly due to reaching the monthly spending
limit" from about 02:05Z. Every trial whose model calls started after that point failed at the agent
step. Effects on this run:

- Five trials that were mid-run when the key died were recorded by the driver as `failure`
  (arktype, katex, meriyah, python-statemachine, build-cython-ext). Their agent stderr shows the 412
  on the final attempts. Under the benchmark rules an infrastructure failure is not a task failure, so
  their evidence was moved to `attempts/<slug>/<ts>-fireworks-412-suspended/` and the tasks will be
  re-run as fresh restores. The four passes recorded before 02:05Z (anko, expr, fastapi, httpx) are
  untouched.
- 16 later trials were `infra_invalid` because the harness exited non-zero on the 412 (retried on re-run).
- 5 terminal-bench trials (chess-best-move, dna-insert, merge-diff-arc-agi-task, polyglot-c-py,
  regex-log) were `infra_invalid` earlier in setup: Harbor's OpenCode `apt-get install nodejs npm`
  hit intermittent `502 Bad Gateway` from archive.ubuntu.com via the Runta egress proxy while four
  trials ran concurrently. Retried on re-run.

Concurrency: from 2026-09-08 ~19:30Z the remaining tasks ran under four concurrent copies of the
unmodified upstream `run-trials.sh` on disjoint `--tasks` lists (16 of the tenant's 32 vCPUs), as
allowed by the skill's quota rules. The first four tasks ran with one sequential driver.

## 2026-09-09 03:22Z resume, and 12:30Z: hung `runta exec` calls

Resumed after Fireworks billing was restored. Since then python-statemachine, arktype, and
build-cython-ext passed; meriyah failed on the 5400 s task timeout (exit 124, a valid failure).

At 12:30Z three of the four drivers had been blocked for 6.5-7.5 hours inside one `runta exec`
call each (readiness probe `sh -lc 'exit 0'`, or the detached-runner launch). The Runta CLI has no
client-side timeout, so a stalled connection never returns and the driver, which otherwise treats a
failed transport call as retryable, waits forever. The stuck CLI processes were killed from the host;
the drivers then followed their own retry/retain paths (trials left with `recovery: true` are
re-collected by re-running the same command, which the finisher now does before scoring). A host-side
watchdog (`logs/runta-watchdog.sh`) kills any `runta exec`/`runta cp` older than 15 minutes for the
rest of the run. No script in `skills/frontierharness-eval/` was modified for this.
