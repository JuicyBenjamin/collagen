#!/bin/bash
# The deterministic scenarios (no LLM), side by side: each one is an island
# (own HOME, profiles, ports, testnet — see lib.sh), so they run in parallel.
# E2E_JOBS caps how many at once (default 6); E2E_ONLY="log attach" picks some.
cd "$(dirname "$0")"
export ROOT_OUT="${COLLAGEN_E2E_OUT:-${TMPDIR:-/tmp}/collagen-e2e}"
mkdir -p "$ROOT_OUT"
ALL="connect ticket-thread log conflict three-members leave approval approval-tui transcripts attach ticket-tui weigh-in"
PICK="${E2E_ONLY:-$ALL}"
# a scenario still running from an earlier invocation shares its twin's HOME and
# ports — the two would wreck each other; say so instead of running
for s in $PICK; do
  if pgrep -f -- "bash (.*/)?$s\.sh\$|--profile [a-z]+-$s( |\$)" > /dev/null; then
    echo "!! $s is still running from an earlier run — stop it first:  pkill -f -- 'bash (.*/)?$s.sh|--profile [a-z]+-$s'"; exit 2
  fi
done
started=$(date +%s)
# one line per scenario as it finishes; full output in $ROOT_OUT/<scenario>.txt
run_one='s=$1; out="$ROOT_OUT/$s.txt"; t0=$(date +%s)
bash "$s.sh" > "$out" 2>&1; code=$?
printf "%-16s %-22s %4ss%s\n" "$s" "$(grep -E "^== " "$out" | tail -1)" "$(( $(date +%s) - t0 ))" "$([ $code -ne 0 ] && echo "  ← see $out")"
exit $code'
printf '%s\n' $PICK | xargs -P "${E2E_JOBS:-6}" -n 1 bash -c "$run_one" _
status=$?
echo "took $(( $(date +%s) - started )) s"
# the FAIL lines of whatever failed, so a red run explains itself
for s in $PICK; do grep -E "^  FAIL|^!!" "$ROOT_OUT/$s.txt" 2>/dev/null | sed "s/^/  [$s] /"; cat "$ROOT_OUT/$s"/*.err 2>/dev/null | grep -v "^$" | head -20 | sed "s/^/  [$s stderr] /"; done
exit $status
