#!/bin/bash
# Who may do what in a room: its creator founds it and owns it; a new room
# lets anyone invite and let in. Alice makes newcomers wait for her, carol
# comes with bob's invite and waits (bob may not let her in), alice lets her
# in; then alice takes bob out, and the room moves to a new key he is not
# given — carol follows it, bob reads nothing written after.
source "$(dirname "$0")/lib.sh"
kill_all; fresh_logs; prep_profiles; testnet

echo "## A. a new room: alice owns it, bob is let in at once"
start alice; start bob
SA=$(mcp $A); wait_for_peer $A "$SA" bob; SB=$(mcp $B); admitted bob
wait_until "alice founded the room: she owns it" "owner: alice" call $A "$SA" get-room-access '{}'
expect "everyone may invite and let in" "$(call $A "$SA" get-room-access '{}')" "everyone \(rank 0\): invite, approve"

echo "## B. alice makes newcomers wait for her"
expect "everyone keeps invite, loses approve" "$(call $A "$SA" set-room-access '{"action":"role","name":"everyone","permissions":["invite"],"said":true}')" 'changed the role "everyone"'
expect "a role changes only on the person's word" "$(call $A "$SA" set-room-access '{"action":"role","name":"everyone","permissions":["invite","approve"]}')" "only on your user's word"
wait_until "bob reads the room's rule" "everyone \(rank 0\): invite —" call $B "$SB" get-room-access '{}'

echo "## C. carol comes with bob's invite: she waits"
NO_INVITE=1 start carol --room st-test3
SC=$(mcp $C)
INV=$(call $B "$SB" invite-to-room '{}' | tail -1)
expect "bob may still invite" "$INV" "st-test3\."
call $C "$SC" join-room "{\"invite\":\"$INV\"}" > /dev/null
wait_until "carol is told she waits, by the room's name" "awaiting approval" call $C "$SC" list-rooms '{}'
wait_until "alice sees carol waiting" "Waiting to be let in: carol" call $A "$SA" get-room-access '{}'
expect "carol's room-connection says she waits, and who could let her in" "$(call $C "$SC" room-connection '{}')" "In the way: Waiting for a member to let you in — [1-9] members? connected"
expect "…and alice's says who waits" "$(call $A "$SA" room-connection '{}')" "Waiting to be let in: carol \([0-9]+ s\)"
expect "bob may not let her in" "$(call $B "$SB" set-room-access '{"action":"let-in","person":"carol","said":true}')" "does not allow it"
expect "…and she is not let in yet" "$(grep -c 'admitted to the room log' "$OUT/carol.log")" "^0$"

echo "## D. alice lets carol in"
expect "alice lets her in" "$(call $A "$SA" set-room-access '{"action":"let-in","person":"carol","said":true}')" "let carol in"
admitted carol
call $A "$SA" create-ticket '{"title":"t1 carol is in","goal":"t1 carol is in","project":"sandbox","steps":[{"id":"s1","owner":"alice","intent":"note","description":"a note"}]}' > /dev/null
wait_until "carol reads the room" "t1 carol is in" goals $C "$SC"
expect "once in, nothing stands in carol's way" "$(call $C "$SC" room-connection '{}')" "Nothing in the way."

echo "## E. alice takes bob out: a new key he is not given"
expect "alice takes bob out" "$(call $A "$SA" set-room-access '{"action":"remove","person":"bob","reason":"left the team","said":true}')" "took bob out"
await_log alice "moved the room to its encrypted log"
wait_until "alice's room says bob is out" "Taken out: bob \(left the team\)" call $A "$SA" get-room-access '{}'
await_log carol "following"
call $A "$SA" create-ticket '{"title":"t2 after bob","goal":"t2 after bob","project":"sandbox","steps":[{"id":"s1","owner":"alice","intent":"note","description":"after"}]}' > /dev/null
wait_until "carol reads what comes after" "t2 after bob" goals $C "$SC"
await_log bob "not among its members"
sleep 3
expect "bob reads nothing written after" "$(goals $B "$SB" 2>&1 | grep -c 't2 after bob')" "^0$"

kill_all
summary
