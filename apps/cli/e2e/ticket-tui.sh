#!/bin/bash
# The ticket page in a pty: bob (mock) creates a ticket; in alice's TUI the
# cursor goes down the overview to the tickets list, enter opens the ticket,
# ↓ walks steps → conversation → diagnostics, enter runs "ask peers for their
# agents' conversations" (bob is asked; he has nothing adopted, so nothing
# comes back), esc returns to the list. Judged from the key trace and logs.
source "$(dirname "$0")/lib.sh"
kill_all; fresh_logs; prep_profiles; testnet
start bob; sleep 3
PTY="$OUT/ticket-tui.out"; MARKS="$OUT/ticket-tui.marks"; LOG="$OUT/ticket-tui.log"
rm -f "$PTY" "$MARKS" "$OUT/ticket-tui.go" "$LOG" "$LOG.keys"
mark() { echo "$1 $(wc -c < "$PTY")" >> "$MARKS"; }
( while [ ! -f "$OUT/ticket-tui.go" ]; do sleep 1; done; sleep 2
  printf '\033'; sleep 1; printf '\033[B'; sleep 1; printf '\033[B'; sleep 1; printf '\033[B'; sleep 1; mark M0_tickets
  printf '\r'; sleep 2; mark M1_opened
  printf '\033[B'; sleep 1; printf '\033[B'; sleep 1; mark M2_diagnostics
  printf '\r'; sleep 3; mark M3_ran
  printf '\033'; sleep 2; printf '\033[B'; sleep 1; mark M4_back; sleep 1; printf 'q' ) | \
  COLLAGEN_DEV=1 COLLAGEN_LOG="$LOG" script -F -q "$PTY" bash -c 'stty rows 45 cols 120; node --experimental-ffi --import tsx src/index.tsx --profile alice' > /dev/null 2>&1 &
sleep 12
SA=$(mcp $A); wait_for_peer $A "$SA" bob; sleep 2

echo "## bob creates a ticket (a mock: no outbox on his side)"
call $A "$SA" drive-peer '{"peer":"bob","action":"create-ticket","project":"sandbox","goal":"explain average()","steps":[{"intent":"investigate","description":"what does average() do","mine":true}]}' > /dev/null
wait_until "the ticket is on alice's log" "explain average" goals $A "$SA"
touch "$OUT/ticket-tui.go"
await_mark() { local i; for i in $(seq 1 40); do grep -q "$1" "$MARKS" 2>/dev/null && return 0; sleep 1; done; echo "  FAIL TUI never reached $1 (see $PTY)"; FAIL=$((FAIL+1)); return 1; }
await_mark M4_back; sleep 3
KEYS=$(cut -d' ' -f2 "$LOG.keys" 2>/dev/null | tr '\n' ' ')
expect "↓↓↓ from the tab bar reached the tickets list" "$KEYS" "tickets"
expect "enter opened the ticket: the cursor landed on its steps" "$KEYS" "ticket-steps"
expect "↓↓ walked to the diagnostics section" "$KEYS" "ticket-diagnostics"
expect "enter ran the transcripts diagnostic against the ticket (bob was asked)" "$(grep -c 'transcripts: asked 1 peer(s) about ticket-' "$LOG")" "^1$"
expect "esc went back to the list: the next ↓ moved in the tickets section" "$(echo "$KEYS" | tr ' ' '\n' | tail -4 | tr '\n' ' ')" "tickets"
kill_all; restore_profiles; summary
