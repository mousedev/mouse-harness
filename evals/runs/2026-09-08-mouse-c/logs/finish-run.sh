#!/usr/bin/env bash
# Waits for every trial-driver worker to exit, runs resume passes for trials retained for
# recovery or marked infra_invalid (FH: "re-run the same command to resume"), then scores,
# charts, and builds the report with FrontierHarness's own scripts. Detached.
set -u
E=$HOME/fh-eval; cd "$E" || exit 1
FH=skills/frontierharness-eval/scripts
RUN=runs/2026-09-08-mouse-c
DRIVER="env FH_TRANSPORT_ATTEMPTS=48 FH_RETRY_DELAY=5 bash $FH/run-trials.sh --checkpoint fh-golden-mouse-v3 --harness mouse --provider fireworks --run-id 2026-09-08-mouse-c --out runs"
alive() { for p in "$E"/logs/worker-*.pid "$E"/logs/driver.pid; do [ -f "$p" ] && kill -0 "$(cat "$p")" 2>/dev/null && return 0; done; return 1; }
needs_pass() { for t in "$RUN"/trials/*/trial.json; do jq -e '.recovery == true or .status == "infra_invalid"' "$t" >/dev/null 2>&1 && return 0; done; [ "$(ls -d "$RUN"/trials/*/ 2>/dev/null | wc -l)" -lt 30 ]; }
while alive; do sleep 60; done
for pass in 1 2 3; do
  needs_pass || break
  echo "=== resume pass $pass $(date -u +%FT%TZ)" >> "$E/logs/driver.log"
  $DRIVER >> "$E/logs/driver.log" 2>&1 &
  echo $! > "$E/logs/driver.pid"
  bash "$E/logs/runta-watchdog.sh" &   # watchdog exits when the driver does (driver.pid is a worker pid for alive())
  wait
  rm -f "$E/logs/driver.pid"
done
{
  echo "all drivers exited at $(date -u +%FT%TZ)"
  node "$FH/normalize-results.mjs" --run "$RUN" --label "Mouse"
  node "$FH/generate-chart.mjs" --run "$RUN"
  node "$FH/build-report.mjs" --run "$RUN"
  echo "--- summary ---"
  for t in "$RUN"/trials/*/trial.json; do
    jq -r '"\(.id) \(.status) reward=\(.reward // "-") cost=\(.cost_usd // "-")"' "$t"
  done
  jq -c '{pass_rate, successful, completed, expected, effective_cost_per_pass, infra_invalid}' "$RUN/candidate.json"
} > "$E/logs/finish-run.log" 2>&1
cp "$E/logs/finish-run.log" "$HOME/mouse-harness/evals/frontierharness/last-run-summary.txt" 2>/dev/null || true
