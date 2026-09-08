# Live run: 2026-09-08-mouse-c (checkpoint fh-golden-mouse-v3, harness commit 315e2b8)

Runs fully detached on this Mac (own session, survives Claude restarts); no Claude session is needed.
Eval checkout: `~/fh-eval` (frontier-harness-eval/eval at e837a70 plus three allowlist hosts, see issue #12).

- Driver log: `~/fh-eval/logs/driver.log` (one line per verdict: `=== [task] success|failure|infra_invalid in Ns`)
- Trial records: `~/fh-eval/runs/2026-09-08-mouse-c/trials/*/trial.json` (status, reward, cost_usd)
- Quick tally: `for t in ~/fh-eval/runs/2026-09-08-mouse-c/trials/*/trial.json; do jq -r '"\(.id) \(.status) \(.reward // "-")"' $t; done`
- Still running? `kill -0 $(cat ~/fh-eval/logs/driver.pid) && echo running`
- Runtimes on Runta: `runta ps -a` (one `fh-...` runtime per active trial; deleted after each trial)
- When the driver exits, `~/fh-eval/logs/finish-run.sh` scores and builds the report into `~/fh-eval/runs/2026-09-08-mouse-c/report/` and copies a summary to `evals/frontierharness/last-run-summary.txt` here.
- Resume after an interruption (same run id; their driver keeps valid attempts and runs only what is missing):
  `cd ~/fh-eval && ./detach.sh logs/driver.log logs/driver.pid -- env FH_TRANSPORT_ATTEMPTS=48 FH_RETRY_DELAY=5 bash skills/frontierharness-eval/scripts/run-trials.sh --checkpoint fh-golden-mouse-v3 --harness mouse --provider fireworks --run-id 2026-09-08-mouse-c --out runs`

Earlier today under the same method (run id 2026-09-08-mouse-b, evidence lost with a session scratchpad): regex-log passed (reward 1, $0.21) and anko passed (reward 1, $2.23); arktype failed.
