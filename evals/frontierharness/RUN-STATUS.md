# Live run: 2026-09-08-mouse-c (checkpoint fh-golden-mouse-v3, harness commit 315e2b8)

Runs fully detached on this Mac (own session, survives Claude restarts); no Claude session is needed.
Eval checkout: `~/fh-eval` (frontier-harness-eval/eval at e837a70 plus three allowlist hosts, see issue #12).

- Since 2026-09-08 ~19:30Z the run uses four concurrent copies of FH's unmodified `run-trials.sh`, each on a disjoint task list (`~/fh-eval/logs/tasks-w{1..4}.txt`), same run id, one 4 vCPU / 8192 MiB restore each (16 of the tenant's 32 vCPUs; permitted by SKILL.md "Runtime quota and concurrency"). The first four tasks ran with a single sequential driver (`logs/driver.log`).
- Worker logs: `~/fh-eval/logs/worker-{1..4}.log` (one line per verdict: `=== [task] success|failure|infra_invalid in Ns`); pids in `logs/worker-{1..4}.pid`
- Trial records: `~/fh-eval/runs/2026-09-08-mouse-c/trials/*/trial.json` (status, reward, cost_usd)
- Quick tally: `for t in ~/fh-eval/runs/2026-09-08-mouse-c/trials/*/trial.json; do jq -r '"\(.id) \(.status) \(.reward // "-")"' $t; done`
- Still running? `for p in ~/fh-eval/logs/worker-*.pid; do kill -0 $(cat $p) 2>/dev/null && echo "$p running"; done`
- Runtimes on Runta: `runta ps -a` (one `fh-...` runtime per active trial; deleted after each trial)
- When every worker has exited, `~/fh-eval/logs/finish-run.sh` scores and builds the report into `~/fh-eval/runs/2026-09-08-mouse-c/report/` and copies a summary to `evals/frontierharness/last-run-summary.txt` here.
- Resume after an interruption (same run id; their driver keeps valid attempts, resumes pending trials, retries infra_invalid). One worker over the whole set:
  `cd ~/fh-eval && ./detach.sh logs/driver.log logs/driver.pid -- env FH_TRANSPORT_ATTEMPTS=48 FH_RETRY_DELAY=5 bash skills/frontierharness-eval/scripts/run-trials.sh --checkpoint fh-golden-mouse-v3 --harness mouse --provider fireworks --run-id 2026-09-08-mouse-c --out runs`
  or per worker, adding `--tasks logs/tasks-wN.txt` and writing to `logs/worker-N.log` / `logs/worker-N.pid`.

Earlier today under the same method (run id 2026-09-08-mouse-b, evidence lost with a session scratchpad): regex-log passed (reward 1, $0.21) and anko passed (reward 1, $2.23); arktype failed.
