#!/bin/bash
# The adopted-thread loop with Claude Code (needs `claude` logged in). Pass the
# id of a Claude Code session of yours as $1: alice adopts bob's thread into it,
# bob's next message makes collagen run `claude -p --resume <session>`, which
# appends a turn to that very session; Claude reads the thread and replies.
source "$(dirname "$0")/lib.sh"
SESSION=${1:?usage: claude-adopt.sh <claude-code-session-id>}
kill_all; fresh_logs; prep_profiles; testnet
start bob; sleep 3; start alice; sleep 9
SA=$(mcp $A); wait_for_peer $A "$SA" bob; sleep 2
pend() { call $A "$SA" pending-threads '{}' | grep -oE '[0-9a-f]{16},[^"\\]*' | head -1; }

call $A "$SA" drive-peer '{"peer":"bob","action":"send-message","project":"loopdemo","intent":"m1","findings":"first message"}' | sed 's/^/  drive: /' 
wait_until "first contact waits in the inbox" "loopdemo,1,m1" pend
CTID=$(pend | cut -d, -f1)
expect "adopted into the Claude session" "$(call $A "$SA" adopt-thread "{\"threadId\":\"$CTID\",\"agent\":\"claude-code\",\"sessionId\":\"$SESSION\"}")" "adopted"
call $A "$SA" drive-peer '{"peer":"bob","action":"send-message","project":"loopdemo","intent":"m2","findings":"TEST of the adopted-thread loop. Claude: pull this thread with get-messages, then reply ONCE with send-to-peer to bob, project loopdemo, intent claude-answer, findings CLAUDE-LOOP-OK. Nothing else, no code changes."}' > /dev/null
wait_until "collagen resumed the Claude session" "continue claude-code" cat "$OUT/alice.log"
WAIT_TRIES=60 wait_until "Claude's run finished" "agent done" cat "$OUT/alice.log"
grep "agent done" "$OUT/alice.log" | tail -1 | cut -c12- | cut -c1-200
wait_until "bob's mock acked Claude's reply" "mock-ack" pend
kill_all; restore_profiles; summary
