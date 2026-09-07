#!/bin/bash
# The adopted-thread loop with codex (needs `codex` logged in): first contact
# queues, alice adopts the thread into a codex conversation, the next message is
# queued into that conversation, codex reads the thread and replies, bob's mock
# acks. Nothing is spawned behind the user: codex only runs when resumed.
source "$(dirname "$0")/lib.sh"
kill_all; fresh_logs; prep_profiles; testnet
start bob; sleep 3; start alice; sleep 9
SA=$(mcp $A); wait_for_peer $A "$SA" bob
pend() { call $A "$SA" pending-threads '{}' | grep -oE '[0-9a-f]{16},[^"\\]*' | head -1; }

echo "## 0. the user's codex conversation"
CODEX_TID=$(codex exec --json -c sandbox_mode="read-only" --skip-git-repo-check "Say only READY" < /dev/null 2>/dev/null | grep -o '"thread_id":"[0-9a-f-]*"' | head -1 | cut -d'"' -f4)
expect "codex started a conversation" "$CODEX_TID" "^[0-9a-f-]{36}$"

echo "## 1. first contact queues"
call $A "$SA" drive-peer '{"peer":"bob","action":"send-message","project":"loopdemo","intent":"m1","findings":"first message - answer both of my messages via send-to-peer to bob with intent codex-answer"}' > /dev/null
wait_until "message waits in the inbox (no ai set)" "loopdemo,1,m1" pend
CTID=$(pend | cut -d, -f1)

echo "## 2. adopt into the codex conversation"
expect "adopted" "$(call $A "$SA" adopt-thread "{\"threadId\":\"$CTID\",\"agent\":\"codex\",\"sessionId\":\"$CODEX_TID\"}")" "adopted"

echo "## 3. the next message is queued INTO codex"
call $A "$SA" drive-peer '{"peer":"bob","action":"send-message","project":"loopdemo","intent":"m2","findings":"second message - say the words LOOP-COMPLETE in your reply"}' > /dev/null
wait_until "collagen queued a nudge into the codex thread" "queued nudge into codex thread" cat "$OUT/alice.log"

echo "## 4. the user resumes codex; it reads the thread and answers"
codex exec resume "$CODEX_TID" --json -c sandbox_mode="read-only" --skip-git-repo-check "Continue." < /dev/null > "$OUT/codex.out" 2>&1
expect "codex pulled the thread" "$(cat "$OUT/codex.out")" '"tool":"[^"]*get-messages'
expect "codex replied via send-to-peer" "$(cat "$OUT/codex.out")" '"tool":"[^"]*send-to-peer'
wait_until "bob's mock acked codex's reply" "mock-ack" pend
kill_all; restore_profiles; summary
