#!/bin/bash
# The outbox in the TUI: everything of alice's that went out, in one list.
# Her "agent" (curl) sends two messages and creates a ticket, all on her word
# — nothing waits for anyone's approval. In the pty: the overview lists the
# ticket the moment it lands, `3` opens the outbox with all three records
# newest first, and `enter` unfolds the text one carried (a long one is
# capped, and the brand above it does not move).
source "$(dirname "$0")/lib.sh"
kill_all; fresh_logs; prep_profiles; testnet
start bob
PTY="$OUT/outbox-tui.out"; MARKS="$OUT/outbox-tui.marks"; LOG="$OUT/outbox-tui.log"
rm -f "$PTY" "$MARKS" "$OUT/outbox-tui.go" "$LOG" "$LOG.keys"
mark() { echo "$1 $(wc -c < "$PTY")" >> "$MARKS"; }
( while [ ! -f "$OUT/outbox-tui.go" ]; do sleep 1; done; wait_pty "$PTY" "tickets"; sleep 1; mark M0_overview
  printf '\033'; sleep 1; printf '\033[B'; sleep 1; printf '\033[B'; sleep 1; mark M1_tickets
  printf '3'; sleep 2; mark M2_outbox
  printf '\033[B'; sleep 1; printf '\033[B'; sleep 1; printf '\r'; sleep 2; mark M3_expanded
  printf '\r'; sleep 1; mark M4_folded
  printf '\033'; sleep 1; printf '\033[D'; sleep 1; mark M5_left_a_tab; sleep 1; printf 'q' ) | \
  HOME="$SHOME" COLLAGEN_DEV=1 COLLAGEN_LOG="$LOG" script -F -q "$PTY" bash -c "stty rows 40 cols 120; $TUI" > /dev/null 2>&1 &
SA=$(mcp $A); wait_for_peer $A "$SA" bob; admitted bob

echo "## alice's agent acts on her word: two messages and a ticket"
LONG_ARGS='{"peer":"bob","project":"sandbox","intent":"ask2","findings":"a review-sized body. line 1 of a body that wraps many times over line 2 of a body that wraps many times over line 3 of a body that wraps many times over line 4 of a body that wraps many times over line 5 of a body that wraps many times over line 6 of a body that wraps many times over line 7 of a body that wraps many times over line 8 of a body that wraps many times over line 9 of a body that wraps many times over line 10 of a body that wraps many times over line 11 of a body that wraps many times over line 12 of a body that wraps many times over line 13 of a body that wraps many times over line 14 of a body that wraps many times over line 15 of a body that wraps many times over line 16 of a body that wraps many times over line 17 of a body that wraps many times over line 18 of a body that wraps many times over line 19 of a body that wraps many times over line 20 of a body that wraps many times over line 21 of a body that wraps many times over line 22 of a body that wraps many times over line 23 of a body that wraps many times over line 24 of a body that wraps many times over line 25 of a body that wraps many times over line 26 of a body that wraps many times over line 27 of a body that wraps many times over line 28 of a body that wraps many times over line 29 of a body that wraps many times over line 30 of a body that wraps many times over line 31 of a body that wraps many times over line 32 of a body that wraps many times over line 33 of a body that wraps many times over line 34 of a body that wraps many times over line 35 of a body that wraps many times over line 36 of a body that wraps many times over line 37 of a body that wraps many times over line 38 of a body that wraps many times over line 39 of a body that wraps many times over line 40 of a body that wraps many times over"}'  # built here: bash 3.2 mangles \" nested in "$( )"
expect "the first message goes" "$(call $A "$SA" send-to-peer '{"peer":"bob","project":"sandbox","intent":"ask","findings":"the short one"}')" "sent to bob"
expect "the second goes too, with a long body" "$(call $A "$SA" send-to-peer "$LONG_ARGS")" "sent to bob"
expect "and a ticket" "$(call $A "$SA" create-ticket '{"goal":"explain the NaN","project":"sandbox","steps":[{"owner":"bob","intent":"investigate","description":"look at average()"}]}')" "goal: explain the NaN"
wait_until "all three are recorded as gone" "^3$" grep -c '↗ ' "$LOG"
touch "$OUT/outbox-tui.go"
await_mark() { local i; for i in $(seq 1 40); do grep -q "$1" "$MARKS" 2>/dev/null && return 0; sleep 1; done; echo "  FAIL TUI never reached $1 (see $PTY)"; FAIL=$((FAIL+1)); return 1; }
await_mark M5_left_a_tab; sleep 1
TEXT=$(perl -pe 's/\e\[[0-9;?]*[a-zA-Z]//g' "$PTY")

echo "## the overview has the ticket at once — it is in the room, not in limbo"
expect "listed by kind and goal" "$(echo "$TEXT" | grep -cE 'task .{0,8}explain the NaN')" "^[1-9]"
expect "nothing says it is waiting for anyone" "$(echo "$TEXT" | grep -cE 'yours to approve|not sent|waiting for your')" "^0$"

echo "## the outbox lists what went, and reads at a glance"
expect "the cursor reached it" "$(cut -d' ' -f2 "$LOG.keys" 2>/dev/null | tr '\n' ' ')" "outbox"
expect "kind · project · who it was for · what about" "$(echo "$TEXT" | grep -cE 'message  sandbox/ .{1,4} bob  ask')" "^[1-9]"
expect "the tab bar counts them" "$(echo "$TEXT" | grep -cE 'outbox \(3\)')" "^[1-9]"
expect "no keys for approving, because there is nothing to approve" "$(echo "$TEXT" | grep -c 'approve and send')" "^0$"
expect "enter unfolds the text it sent" "$(echo "$TEXT" | grep -c 'a review-sized body')" "^[1-9]"
expect "…a body too long for the box points at the rest instead of overflowing" "$(echo "$TEXT" | grep -c 'more line(s)')" "^[1-9]"
expect "…with the brand still above it, not squeezed" "$(echo "$TEXT" | grep -c 'peer-to-peer')" "^[1-9]"

echo "## the tab bar keeps the cursor: ← walks back through the tabs, not out to the rail"
expect "esc put the cursor back on the bar, ← moved one tab left" "$(cut -d' ' -f2 "$LOG.keys" 2>/dev/null | grep -v room | tr '\n' ' ')" "outbox tabs tabs"
kill_all; summary
