#!/usr/bin/env bash
# The Runta CLI has no client-side timeout; a stalled `runta exec`/`runta cp` hangs forever and
# stalls the FH driver, which otherwise treats a failed transport call as retryable. Kill any that
# have run longer than 15 minutes (the longest legitimate call, an evidence copy, takes seconds).
LOG=$HOME/fh-eval/logs/runta-watchdog.log
secs() { # macOS etime: [[dd-]hh:]mm:ss
  local e=$1 d=0 h=0 m s; case "$e" in *-*) d=${e%%-*}; e=${e#*-};; esac
  IFS=: read -r a b c <<<"$e"; if [ -n "$c" ]; then h=$a; m=$b; s=$c; else m=$a; s=$b; fi
  echo $(( (10#$d*24 + 10#$h)*3600 + 10#$m*60 + 10#$s ))
}
while :; do
  ps -axo pid=,etime=,command= | grep -E ' runta (exec|cp) ' | grep -v grep | while read -r pid et rest; do
    if [ "$(secs "$et")" -gt 900 ]; then
      echo "$(date -u +%FT%TZ) killing pid $pid after $et: ${rest:0:110}" >> "$LOG"
      kill "$pid" 2>/dev/null; sleep 2; kill -9 "$pid" 2>/dev/null
    fi
  done
  alive=0; for p in "$HOME"/fh-eval/logs/worker-*.pid "$HOME"/fh-eval/logs/driver.pid; do [ -f "$p" ] &&  kill -0 "$(cat "$p")" 2>/dev/null && alive=1; done
  [ $alive = 1 ] || { echo "$(date -u +%FT%TZ) no workers left, exiting" >> "$LOG"; exit 0; }
  sleep 60
done
