#!/bin/bash
# Three members (all indexers): the view keeps advancing with 1 of 3 and 2 of
# 3 offline, and the absent one catches up on everything when it returns.
source "$(dirname "$0")/lib.sh"
kill_all; fresh_logs; prep_profiles; testnet

echo "## A. all three up"
start alice; start bob; start carol --room st-test3
SA=$(mcp $A); SC=$(mcp $C); wait_for_peer $A "$SA" carol; admitted carol
expect "carol admitted while everyone started at once" "$(cat "$OUT/carol.log")" "admitted to the room log"
call $A "$SA" create-ticket '{"goal":"t1 all three up","project":"sandbox","steps":[{"id":"s1","owner":"carol","intent":"note","description":"carol keeps this pending"}]}' > /dev/null
wait_until "carol sees t1" "t1 all three up" goals $C "$SC"

echo "## B. carol offline (2 of 3 indexers)"
stop carol
call $A "$SA" create-ticket '{"goal":"t2 carol away","project":"sandbox","steps":[{"id":"s1","owner":"bob","intent":"investigate","description":"bob settles"},{"id":"s2","owner":"alice","intent":"review","description":"alice reviews","needs":["s1"]}]}' > /dev/null
wait_until "view advanced with one indexer offline" "s1,bob,investigate,settled" call $A "$SA" get-tickets '{}'

echo "## C. bob offline too (1 of 3)"
stop bob
call $A "$SA" create-ticket '{"goal":"t3 alice alone","project":"sandbox","steps":[{"id":"s1","owner":"alice","intent":"note","description":"solo"}]}' > /dev/null
expect "message to the absent carol accepted" "$(call $A "$SA" send-to-peer '{"peer":"carol","project":"sandbox","intent":"while-away","findings":"for carol"}')" "sent to carol"
wait_until "alice's own append applied alone" "t3 alice alone" goals $A "$SA"

echo "## D. carol returns"
start carol --room st-test3
SC=$(mcp $C)
wait_until "carol caught up on all three tickets" "t1.*t2|t2.*t1" goals $C "$SC"
wait_until "carol has the message sent while she was away" "sandbox" call $C "$SC" pending-threads '{}'

kill_all; summary
