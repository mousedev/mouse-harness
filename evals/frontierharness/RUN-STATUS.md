# Run 2026-09-08-mouse-c: COMPLETE 2026-09-09 14:33Z, 25/30 (83.3%), $2.79 per pass

Final report and submission package: `evals/runs/2026-09-08-mouse-c/` (SUBMISSION.md, report/, NOTES.md). Full evidence tarball on Pete's Mac: `~/fh-eval/fh-run-2026-09-08-mouse-c-full.tar.gz` (69 MB).

# (history) Live run: 2026-09-08-mouse-c (checkpoint fh-golden-mouse-v3, harness commit 315e2b8)

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

## 2026-09-09 03:00Z: paused, Fireworks account suspended

Fireworks suspended the account (HTTP 412, monthly spending limit) at ~02:05Z. Scored before that:
4/4 passes (anko, expr, fastapi, httpx, ~$18). Five trials killed mid-run by the 412 were moved to
`attempts/` as infrastructure failures (see `~/fh-eval/runs/2026-09-08-mouse-c/NOTES.md`); 21 more
are `infra_invalid`. All four workers exited; no Runta runtimes are left. Total spend so far ~$23.

To resume after Fireworks billing is fixed (same run id, valid passes kept; 26 tasks remain):
```
cd ~/fh-eval && for w in 1 2 3 4; do ./detach.sh logs/worker-$w.log logs/worker-$w.pid -- env FH_TRANSPORT_ATTEMPTS=48 FH_RETRY_DELAY=5 bash skills/frontierharness-eval/scripts/run-trials.sh --checkpoint fh-golden-mouse-v3 --harness mouse --provider fireworks --run-id 2026-09-08-mouse-c --out runs --tasks logs/tasks-w$w.txt; sleep 3; done; ./detach.sh logs/finisher.log logs/finisher.pid -- bash logs/finish-run.sh
```
Expect the remaining 26 tasks to cost roughly $60-90 at the observed $2-6 per task; raise the
Fireworks monthly limit accordingly before resuming.

## 2026-09-09 12:45Z: resumed; Runta CLI hangs handled by a host watchdog

Scored so far: 7/8 (meriyah failed on the task timeout). Three drivers spent ~7 h hung inside a
`runta exec` with no client-side timeout; `~/fh-eval/logs/runta-watchdog.sh` now kills any
`runta exec`/`runta cp` older than 15 min (their retry paths take over). `logs/finish-run.sh` runs
up to three sequential resume passes over the full task list for trials flagged `recovery: true` or
`infra_invalid` before scoring. Details in `~/fh-eval/runs/2026-09-08-mouse-c/NOTES.md`.
