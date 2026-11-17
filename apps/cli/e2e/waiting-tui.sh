#!/bin/bash
# Who wants in, and the log, in the TUI. carol comes to alice's room with no
# invite. In the pty: beside the room's name alice reads that one person is
# waiting; `w` opens who it is — carol, at the door with no invite — and
# `enter` lets her in; `l` opens the log, every line whole, where `home`
# reaches its first line; `esc` goes back to where she was. Her agent reads
# the same log (get-log) and takes her to both pages.
source "$(dirname "$0")/lib.sh"
kill_all; fresh_logs; prep_profiles; testnet
start bob
PTY="$OUT/waiting-tui.out"; MARKS="$OUT/waiting-tui.marks"; LOG="$OUT/waiting-tui.log"
rm -f "$PTY" "$MARKS" "$OUT"/waiting-tui.go* "$LOG" "$LOG.keys"
mark() { echo "$1 $(wc -c < "$PTY")" >> "$MARKS"; }
gate() { while [ ! -f "$OUT/waiting-tui.$1" ]; do sleep 0.5; done; }
( gate go; wait_pty "$PTY" "waiting" > /dev/null; sleep 1; mark M0_title
  printf 'w'; sleep 2; mark M1_waiting
  printf '\r'; sleep 3; mark M2_let_in
  printf '\033'; sleep 1; mark M3_back
  printf 'l'; sleep 2; mark M4_log
  printf '\033[1~'; sleep 2; mark M5_log_home
  printf '\033'; sleep 1; mark M6_back
  gate go-agent; sleep 2; mark M7_agent_log
  gate go-agent2; sleep 2; mark M8_agent_waiting; sleep 1; printf 'q' ) | \
  HOME="$SHOME" COLLAGEN_DEV=1 COLLAGEN_LOG="$LOG" script -F -q "$PTY" bash -c "stty rows ${ROWS:-40} cols ${COLS:-120}; $TUI" > /dev/null 2>&1 &
SA=$(mcp $A); wait_for_peer $A "$SA" bob; admitted bob

echo "## carol comes with no invite"
NO_INVITE=1 start carol --room st-test3
SC=$(mcp $C)
wait_until "alice's agent sees her at the door" "At the door, with no invite: carol" call $A "$SA" get-room-access '{}'
wait_until "…and the room counts her as waiting" "waiting" call $A "$SA" list-rooms '{}'
touch "$OUT/waiting-tui.go"
await_mark() { local i; for i in $(seq 1 60); do grep -q "$1" "$MARKS" 2>/dev/null && return 0; sleep 1; done; echo "  FAIL TUI never reached $1 (did it start? see $PTY)"; FAIL=$((FAIL+1)); return 1; }

echo "## enter on her row lets her in"
await_mark M2_let_in
wait_until "carol is in, and writes" "renamed to" call $C "$SC" rename-room '{"name":"dev room, carol in"}'
await_mark M6_back

echo "## alice's agent reads the log, and takes her to both pages"
expect "get-log gives the last lines, oldest first" "$(call $A "$SA" get-log '{"lines":5}')" "^5 of [0-9]+ lines kept, oldest first, UTC:"
expect "…each as the log has it" "$(call $A "$SA" get-log '{"lines":5}' | sed -n 2p)" "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z \[[A-Z]+\] "
expect "…or only what went wrong" "$(call $A "$SA" get-log '{"troubles":true}')" "warnings and errors kept|^No warnings or errors"
expect "…and refuses no lines" "$(call $A "$SA" get-log '{"lines":0}')" "^failed: 'lines'"
expect "open-log takes her to the log" "$(call $A "$SA" open-log '{}')" "^The log is on your user's screen"
touch "$OUT/waiting-tui.go-agent"; await_mark M7_agent_log
expect "open-waiting takes her to who wants in" "$(call $A "$SA" open-waiting '{}')" "^Who wants into the room is on your user's screen"
touch "$OUT/waiting-tui.go-agent2"; await_mark M8_agent_waiting
expect "bob, with no screen, is told so" "$(call $B "$(mcp $B)" open-log '{}')" "^failed: no terminal of collagen's is open"
sleep 1
touch "$OUT/waiting-tui.done"

HAVE_PYTE=no; python3 -c "import pyte" 2>/dev/null && HAVE_PYTE=yes
[ -n "${PYTE_PATH:-}" ] && HAVE_PYTE=yes
if [ "$HAVE_PYTE" = yes ]; then
  render() { python3 "$E2E/render.py" "$PTY" "$MARKS" "${ROWS:-40}" "${COLS:-120}" "$1"; }
  SCREEN=$(render M0_title)
  expect "beside the room's name: one person waiting, and the key" "$SCREEN" "─ dev room.{1,2}1.{1,2}waiting.{1,2}\(w\)"
  expect "the footer no longer carries the log" "$(echo "$SCREEN" | grep -c '^ *activity$')" "^0$"
  SCREEN=$(render M1_waiting)
  expect "w opens who wants in" "$SCREEN" "› ● carol +at the door, no invite"
  expect "…as a page of the room, with the way back" "$SCREEN" "‹ overview +› +waiting"
  SCREEN=$(render M2_let_in)
  expect "enter lets her in, and says so" "$SCREEN" "carol is handed an invite"
  expect "nothing is beside the room's name any more" "$(render M3_back | grep -c 'waiting (w)')" "^0$"
  SCREEN=$(render M4_log)
  expect "l opens the log, on its newest line" "$SCREEN" "› [0-9]{2}[:.][0-9]{2}[:.][0-9]{2}"
  expect "home reaches its first line" "$(render M5_log_home | grep -E '› [0-9]{2}[:.][0-9]{2}[:.][0-9]{2}')" "dev testnet detected"
  expect "esc goes back to the tabs" "$(render M6_back)" "\[1\] overview"
  expect "her agent's open-log put the log on screen" "$(render M7_agent_log)" "‹ overview +› +log"
  expect "…and open-waiting who wants in" "$(render M8_agent_waiting)" "‹ overview +› +waiting"
else
  echo "(pyte not installed — skipping screen checks)"
fi
kill_all; summary
