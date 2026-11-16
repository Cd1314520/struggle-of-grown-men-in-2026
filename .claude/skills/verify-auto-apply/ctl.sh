#!/usr/bin/env bash
# Starts, checks and stops the verification instance of auto-apply. See SKILL.md.
#   ctl.sh start | doctor | stop | reset
# VERIFY_PORT (default 18787) and VERIFY_HOME (default <repo>/artifacts/verify-auto-apply) pick the
# instance; two runs with different values of both do not meet. Runs on Linux and in Git Bash on
# Windows, where there is no /proc for native processes, no ss and no setsid: the pid serve.ts writes is
# a Windows pid, so it is looked up with Windows' own tools.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
PORT="${VERIFY_PORT:-18787}"
HOME_DIR="${VERIFY_HOME:-$REPO/artifacts/verify-auto-apply}"
STATE="$HOME_DIR/state"       # throwaway: database, profile, resume. Removed by stop.
EVIDENCE="$HOME_DIR/evidence" # proof artifacts. Never removed by this script.
PIDFILE="$STATE/server.pid"
LOG="$EVIDENCE/server.log"
BASE="http://127.0.0.1:$PORT"

case "$(uname -s)" in MINGW* | MSYS* | CYGWIN*) WINDOWS=1 ;; *) WINDOWS=0 ;; esac

cmdline() { # a process's command line, or failure when there is no such process
  if [ "$WINDOWS" = 1 ]; then
    local cmd; cmd="$(powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=$1').CommandLine" 2>/dev/null | tr -d '\r')"
    [ -n "$cmd" ] && echo "$cmd"
  else
    tr '\0' ' ' 2>/dev/null <"/proc/$1/cmdline"
  fi
}
alive() { # whether a process with this pid exists
  if [ "$WINDOWS" = 1 ]; then tasklist //FI "PID eq $1" //NH 2>/dev/null | grep -qw "$1"; else [ -d "/proc/$1" ]; fi
}
ours() { # the pid we started, if it is still that process
  [ -f "$PIDFILE" ] || return 1
  local pid; pid="$(tr -d '[:space:]' <"$PIDFILE")"
  local cmd; cmd="$(cmdline "$pid")" || return 1
  # Windows shows the path with backslashes or forward slashes, depending on who started it.
  [[ "$cmd" == *verify-auto-apply[/\\]serve.ts* ]] && echo "$pid"
}
listener() { # pid listening on our port, or nothing
  if [ "$WINDOWS" = 1 ]; then
    netstat -ano -p tcp 2>/dev/null | tr -d '\r' | awk -v port=":$PORT" '$4 == "LISTENING" && substr($2, length($2) - length(port) + 1) == port { print $5; exit }'
    return 0
  fi
  local line; line="$(ss -ltnpH "sport = :$PORT" 2>/dev/null)" || true
  [[ "$line" =~ pid=([0-9]+) ]] && echo "${BASH_REMATCH[1]}" || true
}

case "${1:-}" in
  start)
    if pid="$(ours)"; then echo "already running: pid $pid at $BASE"; exit 0; fi
    if [ -n "$(listener)" ]; then echo "port $PORT is held by pid $(listener), which this script did not start; pick another VERIFY_PORT" >&2; exit 1; fi
    mkdir -p "$STATE" "$EVIDENCE"
    # VERIFY_SNAPSHOT: a directory holding data/, profile/ and resume/ (e.g. a scrubbed copy of the live
    # state) to start from instead of the nine seeded jobs. Copied, so the snapshot itself is never written.
    if [ -n "${VERIFY_SNAPSHOT:-}" ] && [ ! -f "$STATE/data/app.db" ]; then
      cp -r "$VERIFY_SNAPSHOT/." "$STATE/" && echo "state copied from snapshot $VERIFY_SNAPSHOT"
    fi
    # setsid keeps the server out of this shell's session on Linux; Git Bash has none, and a native
    # Windows process outlives the shell that started it anyway.
    detach=(); command -v setsid >/dev/null 2>&1 && detach=(setsid)
    VERIFY_STATE="$STATE" VERIFY_PORT="$PORT" "${detach[@]}" nohup bun "$HERE/serve.ts" >>"$LOG" 2>&1 </dev/null &
    for _ in $(seq 1 150); do
      if curl -fsS "$BASE/__verify" >/dev/null 2>&1 && curl -fsS "$BASE/api/state" >/dev/null 2>&1; then
        echo "ready: $BASE  (pid $(cat "$PIDFILE"), state $STATE, evidence $EVIDENCE)"; exit 0
      fi
      sleep 0.2
    done
    echo "not ready after 30s; see $LOG" >&2; tail -20 "$LOG" >&2; exit 1 ;;
  doctor)
    ok=0
    pid="$(ours)" && echo "ok   process: pid $pid" || { echo "FAIL process: nothing this script started is running (run: ctl.sh start)"; ok=1; }
    own="$(listener)"
    [ -n "${pid:-}" ] && [ "$own" = "$pid" ] && echo "ok   port $PORT is held by that pid" || { echo "FAIL port $PORT is held by pid '${own:-nobody}'"; ok=1; }
    if info="$(curl -fsS "$BASE/__verify" 2>/dev/null)"; then
      echo "ok   identity: $info"
      # On Windows the server reports the Windows path, its backslashes escaped in the JSON.
      want="$STATE"; [ "$WINDOWS" = 1 ] && want="$(cygpath -w "$STATE" | sed 's/\\/\\\\/g')"
      echo "$info" | grep -qF "\"state\":\"$want\"" && echo "ok   state dir is $STATE" || { echo "FAIL instance uses another state dir"; ok=1; }
      head="$(git -C "$REPO" rev-parse --short HEAD)"
      echo "$info" | grep -q "\"rev\":\"$head\"" && echo "ok   started at HEAD $head" || echo "WARN started at another commit than HEAD $head (restart to pick up committed changes)"
      echo "$info" | grep -q '"refusedOutbound":\[\]' || echo "note outbound requests were attempted and refused (listed above)"
    else
      echo "FAIL $BASE/__verify does not answer: this is not the verification instance"; ok=1
    fi
    counts="$(curl -fsS "$BASE/api/state" 2>/dev/null | bun -e 'const s = await Bun.stdin.json(); console.log(JSON.stringify(s.counts), "gmail connected:", s.gmail.connected, "vnc:", s.vncUrl)' 2>/dev/null)" \
      && echo "ok   /api/state: $counts" || { echo "FAIL /api/state does not answer"; ok=1; }
    [ "$ok" = 0 ] && echo "worth driving: $BASE" || echo "NOT worth driving"
    exit "$ok" ;;
  stop)
    if pid="$(ours)"; then
      # Git Bash's kill only knows its own processes, not the Windows pid serve.ts wrote.
      if [ "$WINDOWS" = 1 ]; then taskkill //PID "$pid" //T >/dev/null 2>&1 || taskkill //PID "$pid" //T //F >/dev/null 2>&1; else kill "$pid"; fi
      for _ in $(seq 1 25); do alive "$pid" || break; sleep 0.2; done
      echo "stopped pid $pid"
    else echo "nothing of ours is running"; fi
    rm -rf "$STATE"
    echo "removed $STATE; evidence kept in $EVIDENCE" ;;
  reset) "$0" stop >/dev/null; "$0" start ;;
  *) echo "usage: ctl.sh start|doctor|stop|reset" >&2; exit 2 ;;
esac
