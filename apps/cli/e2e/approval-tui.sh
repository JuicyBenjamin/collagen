#!/bin/bash
# The human gate from the person's side, in the TUI: alice's "agent" (curl)
# queues two messages to bob; they wait in the OUTBOX — everything of hers on
# its way out, in one list. In the pty: 3 opens that tab and the cursor is on
# the newest row (the second proposal) — `n` drops it; the list shrinks and
# the cursor lands on the first — `y` sends it. Judged from both logs, the
# screen and the key trace.
source "$(dirname "$0")/lib.sh"
kill_all; fresh_logs; prep_profiles; testnet
start bob
PTY="$OUT/approval-tui.out"; MARKS="$OUT/approval-tui.marks"; LOG="$OUT/approval-tui.log"
rm -f "$PTY" "$MARKS" "$OUT/approval-tui.go" "$LOG" "$LOG.keys"
mark() { echo "$1 $(wc -c < "$PTY")" >> "$MARKS"; }
( while [ ! -f "$OUT/approval-tui.go" ]; do sleep 1; done; wait_pty "$PTY" "messages"; sleep 1; mark M0_queued
  printf '\033'; sleep 1; printf '3'; sleep 2; mark M1_outbox
  printf 'n'; sleep 2; mark M2_rejected
  printf 'y'; sleep 4; mark M3_approved; sleep 1; printf 'q' ) | \
  HOME="$SHOME" COLLAGEN_DEV=1 COLLAGEN_LOG="$LOG" script -F -q "$PTY" bash -c "stty rows 40 cols 120; $TUI" > /dev/null 2>&1 &
SA=$(mcp $A); wait_for_peer $A "$SA" bob; admitted bob

echo "## alice's agent queues two messages"
expect "first is queued" "$(call $A "$SA" send-to-peer '{"peer":"bob","project":"sandbox","intent":"ask","findings":"the one alice approves"}')" "queued for your user's approval"
expect "second is queued" "$(call $A "$SA" send-to-peer '{"peer":"bob","project":"sandbox","intent":"ask2","findings":"the one alice rejects"}')" "queued for your user's approval"
wait_until "both wait" "^2$" grep -c 'outbox: message → bob' "$LOG"
touch "$OUT/approval-tui.go"
await_mark() { local i; for i in $(seq 1 40); do grep -q "$1" "$MARKS" 2>/dev/null && return 0; sleep 1; done; echo "  FAIL TUI never reached $1 (did it start? see $PTY)"; FAIL=$((FAIL+1)); return 1; }
await_mark M3_approved && wait_until "y sent the first one — bob has it" "^1$" grep -c '← alice \[sandbox/ask\]' "$OUT/bob.log"
sleep 2 # a negative: give anything that would leak time to arrive
expect "n dropped the second (the newest row) — logged as rejected" "$(grep -c '✗ rejected: message → bob · sandbox · ask2' "$LOG")" "^1$"
expect "the approval is logged" "$(grep -c '✓ approved: message → bob · sandbox · ask —' "$LOG")" "^1$"
expect "only one message ever reached bob" "$(grep -c '← alice' "$OUT/bob.log")" "^1$"
expect "the keys landed in the outbox, its own list" "$(cut -d' ' -f2 "$LOG.keys" 2>/dev/null | tr '\n' ' ')" "outbox"
TEXT=$(perl -pe 's/\e\[[0-9;?]*[a-zA-Z]//g' "$PTY")
expect "the tab bar counts what is waiting" "$(echo "$TEXT" | grep -cE '\[3\] outbox')" "^[1-9]"
expect "the outbox says nothing has left this machine" "$(echo "$TEXT" | grep -c 'nothing here has left this machine')" "^[1-9]"
expect "…and lists both proposals by where they are going" "$(echo "$TEXT" | grep -cE 'you .{1,4} bob .{0,3}\[sandbox')" "^[1-9]"
kill_all; summary
