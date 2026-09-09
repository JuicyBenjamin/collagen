#!/bin/bash
# Two self-appointed creators of one room (e.g. a room from before logs
# existed): the log nobody else is on must yield, and the ticket flow must
# still complete on the surviving log.
source "$(dirname "$0")/lib.sh"
kill_all; fresh_logs; prep_profiles 1; testnet
start bob; start alice
SA=$(mcp $A); wait_for_peer $A "$SA" bob; await_any "admitted to the room log"
BOTH=$(cat "$OUT/alice.log" "$OUT/bob.log")
expect "one side abandoned its lonely log" "$BOTH" "abandoning our lonely log"
expect "the other kept its populated one" "$BOTH" "keeping ours"
expect "the abandoner was admitted" "$BOTH" "admitted to the room log"
call $A "$SA" create-ticket '{"goal":"after conflict","project":"sandbox","steps":[{"id":"s1","owner":"bob","intent":"investigate","description":"x"},{"id":"s2","owner":"alice","intent":"review","description":"y","needs":["s1"]}]}' > /dev/null
wait_until "ticket completed across the surviving log" "s1,bob,investigate,settled" call $A "$SA" get-tickets '{}'
kill_all; summary
