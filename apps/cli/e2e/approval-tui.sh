#!/bin/bash
# The human gate from the person's side, in the TUI. alice's "agent" (curl)
# queues three things: two messages to bob and a ticket it wants to create.
# Nothing has left the machine.
#
# In the pty: the overview's ticket list carries the queued ticket like any
# other, marked not sent — `n` there drops it. Then `3` opens the outbox,
# every outgoing thing of hers in one list, newest first: `n` drops the
# second message, the cursor lands on the first, `y` sends it. Judged from
# both logs, the screen and the key trace.
source "$(dirname "$0")/lib.sh"
kill_all; fresh_logs; prep_profiles; testnet
start bob
PTY="$OUT/approval-tui.out"; MARKS="$OUT/approval-tui.marks"; LOG="$OUT/approval-tui.log"
rm -f "$PTY" "$MARKS" "$OUT/approval-tui.go" "$LOG" "$LOG.keys"
mark() { echo "$1 $(wc -c < "$PTY")" >> "$MARKS"; }
( while [ ! -f "$OUT/approval-tui.go" ]; do sleep 1; done; wait_pty "$PTY" "tickets"; sleep 1; mark M0_queued
  printf '\033'; sleep 1; printf '\033[B'; sleep 1; printf '\033[B'; sleep 1; mark M1_tickets
  printf 'n'; sleep 2; mark M2_ticket_dropped
  printf '3'; sleep 2; mark M3_outbox
  printf '\r'; sleep 2; mark M3b_expanded
  printf '\r'; sleep 1; mark M3c_folded
  printf 'n'; sleep 2; mark M4_rejected
  printf 'y'; sleep 4; mark M5_approved; sleep 1; printf 'q' ) | \
  HOME="$SHOME" COLLAGEN_DEV=1 COLLAGEN_LOG="$LOG" script -F -q "$PTY" bash -c "stty rows 40 cols 120; $TUI" > /dev/null 2>&1 &
SA=$(mcp $A); wait_for_peer $A "$SA" bob; admitted bob

echo "## alice's agent queues two messages and a ticket"
expect "first message is queued" "$(call $A "$SA" send-to-peer '{"peer":"bob","project":"sandbox","intent":"ask","findings":"the one alice approves"}')" "queued for your user's approval"
LONG_ARGS='{"peer":"bob","project":"sandbox","intent":"ask2","findings":"the one alice rejects. line 1 of a review-sized body that wraps many times over line 2 of a review-sized body that wraps many times over line 3 of a review-sized body that wraps many times over line 4 of a review-sized body that wraps many times over line 5 of a review-sized body that wraps many times over line 6 of a review-sized body that wraps many times over line 7 of a review-sized body that wraps many times over line 8 of a review-sized body that wraps many times over line 9 of a review-sized body that wraps many times over line 10 of a review-sized body that wraps many times over line 11 of a review-sized body that wraps many times over line 12 of a review-sized body that wraps many times over line 13 of a review-sized body that wraps many times over line 14 of a review-sized body that wraps many times over line 15 of a review-sized body that wraps many times over line 16 of a review-sized body that wraps many times over line 17 of a review-sized body that wraps many times over line 18 of a review-sized body that wraps many times over line 19 of a review-sized body that wraps many times over line 20 of a review-sized body that wraps many times over line 21 of a review-sized body that wraps many times over line 22 of a review-sized body that wraps many times over line 23 of a review-sized body that wraps many times over line 24 of a review-sized body that wraps many times over line 25 of a review-sized body that wraps many times over line 26 of a review-sized body that wraps many times over line 27 of a review-sized body that wraps many times over line 28 of a review-sized body that wraps many times over line 29 of a review-sized body that wraps many times over line 30 of a review-sized body that wraps many times over line 31 of a review-sized body that wraps many times over"}'  # built here: bash 3.2 mangles \" nested in "$( )"
expect "second message is queued, with a review-sized body" "$(call $A "$SA" send-to-peer "$LONG_ARGS")" "queued for your user's approval"
expect "a ticket it wants to create is queued too" "$(call $A "$SA" create-ticket '{"goal":"explain the NaN","project":"sandbox","steps":[{"owner":"bob","intent":"investigate","description":"look at average()"}]}')" "queued for your user's approval"
wait_until "all three wait" "^3$" grep -c '⧗ outbox:' "$LOG"
touch "$OUT/approval-tui.go"
await_mark() { local i; for i in $(seq 1 40); do grep -q "$1" "$MARKS" 2>/dev/null && return 0; sleep 1; done; echo "  FAIL TUI never reached $1 (did it start? see $PTY)"; FAIL=$((FAIL+1)); return 1; }
await_mark M5_approved && wait_until "y sent the first message — bob has it" "^1$" grep -c '← alice \[sandbox/ask\]' "$OUT/bob.log"
sleep 2 # a negative: give anything that would leak time to arrive
TEXT=$(perl -pe 's/\e\[[0-9;?]*[a-zA-Z]//g' "$PTY")

echo "## the queued ticket is a ticket: it is in the overview's list"
expect "listed with the rest, by kind, marked as yours by a glyph" "$(echo "$TEXT" | grep -cE '.{1,3} task .{0,8}explain the NaN')" "^[1-9]"
expect "…the glyph, not a sentence" "$(echo "$TEXT" | grep -c 'yours to approve')" "^0$"
expect "…and the section header is a count, nothing more" "$(echo "$TEXT" | grep -cE 'tickets \(1\)')" "^[1-9]"
expect "…and n dropped it from there" "$(grep -c '✗ rejected: ticket → bob' "$LOG")" "^1$"
expect "the cursor was in the tickets section, not a section of its own" "$(cut -d' ' -f2 "$LOG.keys" 2>/dev/null | tr '\n' ' ')" "tickets"

echo "## the outbox is one list of everything going out"
expect "n dropped the second message" "$(grep -c '✗ rejected: message → bob · sandbox · ask2' "$LOG")" "^1$"
expect "y sent the first, and it is logged" "$(grep -c '✓ approved: message → bob · sandbox · ask —' "$LOG")" "^1$"
expect "only one message ever reached bob" "$(grep -c '← alice' "$OUT/bob.log")" "^1$"
expect "the keys landed in the outbox" "$(cut -d' ' -f2 "$LOG.keys" 2>/dev/null | tr '\n' ' ')" "outbox"
expect "enter unfolds a row: the text, and when it was queued" "$(echo "$TEXT" | grep -c 'the one alice rejects')" "^[1-9]"
expect "…a body too long for the box says where the rest is, instead of overflowing" "$(echo "$TEXT" | grep -c 'more line(s)')" "^[1-9]"
expect "…with the brand still above it, not squeezed into itself" "$(echo "$TEXT" | grep -c 'peer-to-peer')" "^[1-9]"
expect "the tab bar carries the count, and nothing else" "$(echo "$TEXT" | grep -cE 'outbox \(2\)')" "^[1-9]"
expect "no prose in the header: the count is the whole signal" "$(echo "$TEXT" | grep -cE 'outbox .{0,3}[0-9].{0,3} .{0,4}(waiting|nothing)')" "^0$"
expect "…nor next to the ai in the status line" "$(echo "$TEXT" | grep -cE '[0-9] to approve')" "^0$"
kill_all; summary
