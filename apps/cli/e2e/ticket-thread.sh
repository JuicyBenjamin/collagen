#!/bin/bash
# A ticket has no thread of its own: a step delivered to its owner lands on the
# same thread a plain message between those two peers would.
source "$(dirname "$0")/lib.sh"
kill_all; fresh_logs; prep_profiles; testnet
start bob; start alice; sleep 9
SA=$(mcp $A); wait_for_peer $A "$SA" bob; sleep 2
call $A "$SA" drive-peer '{"peer":"bob","action":"send-message","project":"sandbox","intent":"hello","findings":"plain message, establishes the pair thread"}' > /dev/null
sleep 5
PAIR=$(call $A "$SA" pending-threads '{}' | grep -oE '[0-9a-f]{16}' | head -1)
expect "a plain message from bob is waiting" "$PAIR" "^[0-9a-f]{16}$"
call $A "$SA" create-ticket '{"goal":"explain average()","project":"sandbox","steps":[{"id":"s1","owner":"bob","intent":"investigate","description":"what does average() do"},{"id":"s2","owner":"alice","intent":"review","description":"check bob answer","needs":["s1"]}]}' > /dev/null
wait_until "the review step arrived on the SAME thread as bob's message (2 waiting there)" "$PAIR,alice,sandbox,2,.*ticket-step:review" call $A "$SA" pending-threads '{}'
kill_all; restore_profiles; summary
