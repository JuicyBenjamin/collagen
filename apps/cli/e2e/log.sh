#!/bin/bash
# The room log end to end: admission, a ticket whose step the mock settles on
# its own (delivered on the peer-pair thread), a message sent while the peer is
# offline and delivered when it returns, and a solo restart that keeps the
# ticket, re-delivers the pending step and still shows the unread ack.
source "$(dirname "$0")/lib.sh"
kill_all; fresh_logs; prep_profiles; testnet

echo "## 1. both up"
start bob; start alice
SA=$(mcp $A); wait_for_peer $A "$SA" bob; admitted bob
expect "bob admitted" "$(cat "$OUT/bob.log")" "admitted to the room log"
call $A "$SA" create-ticket '{"goal":"log survives","project":"sandbox","steps":[{"id":"s1","owner":"bob","intent":"investigate","description":"what does average() do"},{"id":"s2","owner":"alice","intent":"review","description":"check bob answer","needs":["s1"]}]}' > /dev/null
wait_until "mock settled s1 → alice's review step on the pair thread" "ticket-step:review" call $A "$SA" pending-threads '{}'
THREAD=$(call $A "$SA" pending-threads '{}' | grep -oE '[0-9a-f]{16}' | head -1)

echo "## 2. bob down, alice messages him anyway"
stop bob
expect "send to offline member accepted" "$(call $A "$SA" send-to-peer '{"peer":"bob","project":"sandbox","intent":"while-you-were-out","findings":"sent while bob was offline"}')" "sent to bob"

echo "## 3. bob returns"
start bob
wait_until "bob got the offline message" "← alice \[sandbox/while-you-were-out\]" cat "$OUT/bob.log"
wait_until "bob's mock acked it" "mock-ack" call $A "$SA" pending-threads '{}'


echo "## 4. everyone restarts; alice alone"
stop_all
start alice
SA=$(mcp $A)
wait_until "ticket still there with bob's result" "s1,bob,investigate,settled" call $A "$SA" get-tickets '{}'
wait_until "review step re-delivered and the ack still unread (2 waiting)" "$THREAD,[a-z]+,sandbox,2," call $A "$SA" pending-threads '{}'
wait_until "bob remembered as an offline member" "offlineMembers\[1\]: bob" call $A "$SA" list-room '{}'

kill_all; summary
