#!/bin/bash
# One person on two machines. Alice shares her identity with bob's machine,
# bob's machine takes hers: neither alone does anything, and once both are
# asked the two are one person with two devices. Either names a device; only
# the parent hands its part on or puts a device out.
source "$(dirname "$0")/lib.sh"
kill_all; fresh_logs; prep_profiles; testnet

restarts() { call "$1" "$2" devices '{}' | grep -c Restart; }
count_devices() { call "$1" "$2" devices '{}' | wc -l | tr -d ' '; }

start alice; start bob
SA=$(mcp $A); wait_for_peer $A "$SA" bob; SB=$(mcp $B); admitted bob

echo "## A. alone, each machine is its own one device"
expect "alice has one device, this one, the parent" "$(call $A "$SA" devices '{}' | grep -c 'this one — parent')" "^1$"

echo "## B. one side asked: nothing changes"
expect "alice offers" "$(call $A "$SA" share-identity '{"person":"bob"}')" "offered to bob"
sleep 2
expect "…and still has one device" "$(call $A "$SA" devices '{}' | wc -l | tr -d ' ')" "^1$"
expect "a name nobody here has is refused" "$(call $B "$SB" take-identity '{"person":"nobody"}')" "no one here is called nobody"

echo "## C. the other side asked too: one person, two devices"
expect "bob's machine asks" "$(call $B "$SB" take-identity '{"person":"alice"}')" "asked alice"
wait_until "alice has two devices" "bob" call $A "$SA" devices '{}'
wait_until "bob's machine lists both, and is not the parent" "this one$" call $B "$SB" devices '{}'
expect "a machine that is someone's device takes no other identity" "$(call $B "$SB" take-identity '{"person":"alice"}')" "already one of someone's devices"
expect "…and shares nothing: it is not the parent" "$(call $B "$SB" share-identity '{"person":"alice"}')" "only the parent device"

echo "## C2. from its next start, bob's machine is alice — in the room it was in, and in her other one"
expect "until then it says so" "$(call $B "$SB" devices '{}')" "Restart collagen on this machine"
stop bob; start bob; SB=$(mcp $B)
wait_until "it no longer asks for a restart" "^0$" restarts $B "$SB"
wait_until "the room alice made elsewhere opens on it" "work" call $B "$SB" list-rooms '{}'
call $B "$SB" switch-room "{\"room\":\"work\"}" > /dev/null
wait_until "it is let in to write there, with no invite" "renamed to" call $B "$SB" rename-room '{"name":"work shared"}'
wait_until "alice reads what it wrote there" "work shared" call $A "$SA" list-rooms '{}'
call $B "$SB" switch-room '{"room":"dev room"}' > /dev/null

echo "## C3. to someone else in the room, the two machines are one person"
start carol --room st-test3
SC=$(mcp $C); wait_for_peer $C "$SC" alice; admitted carol
wait_until "carol sees alice" "name: alice" call $C "$SC" list-room '{}'
expect "…and nobody called bob" "$(call $C "$SC" list-room '{}' | grep -c 'name: bob')" "^0$"
wait_until "the room's members are alice and carol" "Members: (alice, carol|carol, alice)$" call $C "$SC" get-room-access '{}'
call $B "$SB" create-ticket '{"title":"t1 from the laptop","goal":"t1 from the laptop","project":"sandbox","steps":[{"id":"s1","owner":"alice","intent":"note","description":"a note"}]}' > /dev/null
wait_until "a ticket filed on bob's machine is alice's, on her own machine" "t1 from the laptop" goals $A "$SA"
expect "…and hers to carol" "$(call $C "$SC" get-ticket "{\"ticketId\":\"$(call $C "$SC" get-tickets '{}' | grep -oE '[0-9a-f-]{36}' | head -1)\"}")" "alice"

echo "## D. a device is named from either machine"
BOBS=$(call $B "$SB" devices '{}' | grep 'this one' | sed 's/ — this one.*//')
wait_until "bob's machine names itself" "is now called laptop" call $B "$SB" set-device "{\"action\":\"name\",\"device\":\"$BOBS\",\"name\":\"laptop\"}"
wait_until "alice sees the name" "^laptop" call $A "$SA" devices '{}'

echo "## E. the parent's part: handed on by the parent only, then the old parent can be put out"
ALICES=$(call $A "$SA" devices '{}' | grep 'this one' | sed 's/ — this one.*//')
expect "bob's machine cannot put the parent out" "$(call $B "$SB" set-device "{\"action\":\"put-out\",\"device\":\"$ALICES\"}")" "is the parent"
expect "alice hands it on" "$(call $A "$SA" set-device '{"action":"hand-over","device":"laptop"}')" "laptop is the parent now"
wait_until "bob's machine is the parent" "this one — parent" call $B "$SB" devices '{}'
expect "alice no longer shares" "$(call $A "$SA" share-identity '{"person":"carol"}')" "only the parent device"
wait_until "the new parent puts the old one out" "no longer one of your user's devices" call $B "$SB" set-device "{\"action\":\"put-out\",\"device\":\"$ALICES\"}"
wait_until "…and has one device left" "^1$" count_devices $B "$SB"

echo "## F. it holds over a restart"
stop bob; start bob; SB=$(mcp $B)
wait_until "bob's machine is still the parent" "this one — parent" call $B "$SB" devices '{}'

kill_all
summary
