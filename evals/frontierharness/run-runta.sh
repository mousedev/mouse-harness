#!/usr/bin/env bash
# Drive the FrontierHarness evaluation of Mouse on Runta, end to end.
#
#   evals/frontierharness/run-runta.sh provision   # golden checkpoint from REPO@COMMIT
#   evals/frontierharness/run-runta.sh smoke       # one Terminal-Bench + one DeepSWE task
#   evals/frontierharness/run-runta.sh trials      # the published 30-task set
#   evals/frontierharness/run-runta.sh retry FILE  # re-run the task ids listed in FILE
#   evals/frontierharness/run-runta.sh score       # fill trial.json, normalize, chart, report
#
# Wraps frontier-harness-eval's own scripts (skills/frontierharness-eval/scripts)
# rather than replacing them, so the run stays the one their team can reproduce.
# Two things need wrapping: Pier 0.3.1 takes custom agents through
# --agent-import-path and --jobs-dir (the skill's default template uses --agent
# and --output-dir), and run-trials.sh applies one --cmd to every task, so
# Terminal-Bench and DeepSWE tasks are run as two invocations of the same
# --run-id. Both suites land in the same runs/<run-id>/trials/ directory.
#
# Required environment:
#   FH_EVAL   checkout of https://github.com/frontier-harness-eval/eval
#   REPO      public git URL of the Mouse harness (provision only)
#   COMMIT    commit to pin (provision only)
# Optional:
#   PROVIDER      fireworks (default; matches the baselines) | openrouter | moonshot | together
#   CHECKPOINT    fh-golden-mouse-v1
#   RUNTIME       fh-build (name of the throwaway build runtime; deleted after the checkpoint)
#   RUN_ID        <today>-mouse
#   DEEP_SWE_REF  datacurve-ai/deep-swe ref; benchmark.json says v1.1, which is
#                 not a tag in that repo, so this pins the main commit that
#                 carries the v1.1 task images (0b9fabbb, 2026-08-26).
#   OUT           runs (relative to FH_EVAL)
set -euo pipefail

cmd=${1:-}
shift || true
MOUSE=$(cd "$(dirname "$0")/../.." && pwd)
: "${FH_EVAL:?set FH_EVAL to a checkout of frontier-harness-eval/eval}"
PROVIDER=${PROVIDER:-fireworks}
CHECKPOINT=${CHECKPOINT:-fh-golden-mouse-v1}
RUNTIME=${RUNTIME:-fh-build}
RUN_ID=${RUN_ID:-$(date +%F)-mouse}
DEEP_SWE_REF=${DEEP_SWE_REF:-0b9fabbb63b9104d678fe965e1632f2dd9eaa2ea}
OUT=${OUT:-runs}
HARNESS="evals.fh:MouseAgent"
PIER_CMD='pier run -p /work/deep-swe/tasks/{task} --agent-import-path {harness} --model {model} --jobs-dir {jobs} -y'

cd "$FH_EVAL"
FH=skills/frontierharness-eval/scripts
[ -x "$FH/run-trials.sh" ] || { echo "$FH_EVAL does not contain the frontierharness-eval skill" >&2; exit 1; }

run_split() {
  # $1: file of suite-prefixed task ids. Terminal-Bench goes through the skill's
  # default Harbor template; DeepSWE through Pier with the corrected flags.
  local list=$1 tb dc
  tb=$(mktemp) dc=$(mktemp)
  grep '^terminal-bench/' "$list" > "$tb" || true
  grep '^datacurve/' "$list" > "$dc" || true
  if [ -s "$tb" ]; then
    echo "== $(wc -l < "$tb" | tr -d ' ') Terminal-Bench task(s) through Harbor" >&2
    "$FH/run-trials.sh" --checkpoint "$CHECKPOINT" --harness "$HARNESS" --provider "$PROVIDER" \
      --run-id "$RUN_ID" --tasks "$tb" --out "$OUT"
  fi
  if [ -s "$dc" ]; then
    echo "== $(wc -l < "$dc" | tr -d ' ') DeepSWE task(s) through Pier" >&2
    "$FH/run-trials.sh" --checkpoint "$CHECKPOINT" --harness "$HARNESS" --provider "$PROVIDER" \
      --run-id "$RUN_ID" --tasks "$dc" --out "$OUT" --cmd "$PIER_CMD"
  fi
  rm -f "$tb" "$dc"
}

case "$cmd" in
  provision)
    : "${REPO:?set REPO to the public harness repo URL}"
    : "${COMMIT:?set COMMIT to the commit to pin}"
    "$FH/provision-golden-checkpoint.sh" \
      --runtime "$RUNTIME" --checkpoint "$CHECKPOINT" \
      --harness "$HARNESS" --provider "$PROVIDER" \
      --repo "$REPO" --commit "$COMMIT" \
      --cpus 4 --memory 8192 --disk-size-gib 100 \
      --prepull-tasks tasks --deep-swe-ref "$DEEP_SWE_REF" \
      --install-script "$MOUSE/install-mouse.sh"
    cp "manifest-${CHECKPOINT}.json" "$MOUSE/evals/frontierharness/" 2>/dev/null || true
    ;;
  smoke)
    run_split "$MOUSE/evals/frontierharness/smoke-tasks.txt"
    python3 "$MOUSE/evals/frontierharness/fill_trials.py" "$OUT/$RUN_ID"
    echo "Spot-check before the full run: jq . $OUT/$RUN_ID/trials/*/trial.json" >&2
    ;;
  trials)
    run_split "$MOUSE/evals/frontierharness/all-tasks.txt"
    ;;
  retry)
    [ -r "${1:-}" ] || { echo "retry needs a file of task ids" >&2; exit 2; }
    run_split "$1"
    ;;
  score)
    python3 "$MOUSE/evals/frontierharness/fill_trials.py" "$OUT/$RUN_ID"
    node "$FH/normalize-results.mjs" --run "$OUT/$RUN_ID" --label "Mouse"
    node "$FH/generate-chart.mjs" --run "$OUT/$RUN_ID"
    node "$FH/build-report.mjs" --run "$OUT/$RUN_ID"
    echo "Report: $FH_EVAL/$OUT/$RUN_ID/report/REPORT.md" >&2
    ;;
  *)
    sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
