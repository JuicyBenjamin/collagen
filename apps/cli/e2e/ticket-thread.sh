#!/bin/bash
# A ticket has no thread of its own: a step delivered to its owner lands on the
# same thread a plain message between those two peers would.
source "$(dirname "$0")/lib.sh"
kill_all; fresh_logs; prep_profiles; testnet
start bob; start alice
SA=$(mcp $A); wait_for_peer $A "$SA" bob; admitted bob
call $A "$SA" drive-peer '{"peer":"bob","action":{"kind":"send-message","project":"sandbox","intent":"hello","findings":"plain message, establishes the pair thread"}}' > /dev/null
wait_until "a plain message from bob is waiting" "[0-9a-f]{16}" call $A "$SA" pending-threads '{}'
PAIR=$(call $A "$SA" pending-threads '{}' | grep -oE '[0-9a-f]{16}' | head -1)
# steering: alice lets her agent act — every delivery now says so
expect "set-steering is the person's dial, and room-facing acts stay theirs" "$(call $A "$SA" set-steering '{"steering":"act"}')" "steering set to act .{1,4} act, then tell.*remain your user.s word"
call $A "$SA" create-ticket '{"title":"explain average()","goal":"explain average()","project":"sandbox","steps":[{"id":"s1","owner":"bob","intent":"investigate","description":"what does average() do"},{"id":"s2","owner":"alice","intent":"review","description":"check bob answer","needs":["s1"]}]}' > /dev/null
wait_until "the review step arrived on the SAME thread as bob's message (2 waiting there)" "$PAIR,alice,sandbox,2,.*ticket-step:review" call $A "$SA" pending-threads '{}'
MSGS=$(call $A "$SA" get-messages "{\"threadId\":\"$PAIR\"}")
expect "the step itself carries her steering, on the turn her agent reads it" "$MSGS" "check bob answer.*STEERING — act, then tell"
expect "…and so does what get-messages hands over" "$MSGS" "^.?steering: .{0,3}STEERING — act, then tell"
kill_all; summary
