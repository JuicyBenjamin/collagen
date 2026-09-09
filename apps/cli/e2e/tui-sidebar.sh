#!/bin/bash
# The TUI in a pty: alice (two rooms) with bob (mock) present. Bob's message
# lights the unread dot; ← hovers the rail, ↑ picks the other room, enter
# switches, ↓↓ + enter opens the "+" frame, esc returns, q quits. Judged by
# the app's own key trace; screens rendered with pyte (see README).
source "$(dirname "$0")/lib.sh"
kill_all; fresh_logs; prep_profiles; testnet
start bob
PTY="$OUT/tui.out"; MARKS="$OUT/tui.marks"; rm -f "$PTY" "$MARKS" "$OUT/tui.go" "$OUT/tui.log" "$OUT/tui.log.keys"
mark() { echo "$1 $(wc -c < "$PTY")" >> "$MARKS"; }
( while [ ! -f "$OUT/tui.go" ]; do sleep 1; done; sleep 3; mark M0_initial; printf '\033[D'; sleep 2; mark M1_rail; printf '\033[A'; sleep 1; mark M2_up; printf '\r'; sleep 4; mark M3_switched
  printf '\033[B'; sleep 1; printf '\033[B'; sleep 1; printf '\r'; sleep 2; mark M4_new_room; printf '\033'; sleep 2; mark M5_back; sleep 1; printf 'q' ) | \
  HOME="$SHOME" COLLAGEN_DEV=1 COLLAGEN_LOG="$OUT/tui.log" script -F -q "$PTY" bash -c "stty rows 40 cols 120; $TUI" > /dev/null 2>&1 &
SA=$(mcp $A); wait_for_peer $A "$SA" bob; admitted bob
call $A "$SA" drive-peer '{"peer":"bob","action":"send-message","project":"sandbox","intent":"sidebar-test","findings":"hello alice, this should light the unread dot"}' > /dev/null
wait_until "alice's room shows bob online and one unread" "dev room,2,1,true" call $A "$SA" list-rooms '{}'
touch "$OUT/tui.go"
await_mark() { local i; for i in $(seq 1 40); do grep -q "$1" "$MARKS" 2>/dev/null && return 0; sleep 1; done; echo "  FAIL TUI never reached $1 (did it start? see $PTY)"; FAIL=$((FAIL+1)); return 1; }
await_mark M3_switched && expect "enter on the other room switched focus" "$(call $A "$SA" list-rooms '{}')" "work,1,0,true"
await_mark M5_back
sleep 1
KEYS=$(cut -d' ' -f2 "$OUT/tui.log.keys" 2>/dev/null | tr '\n' ' ')
expect "← reached the rail" "$KEYS" "rooms"
if python3 -c "import pyte" 2>/dev/null || [ -n "${PYTE_PATH:-}" ]; then
  echo "--- screen after the switch:"; python3 "$E2E/render.py" "$PTY" "$MARKS" 40 120 M3_switched | sed -n 6,12p
else
  echo "(pyte not installed — skipping screen render; key trace judged only)"
fi
kill_all; summary
