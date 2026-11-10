#!/bin/bash
# One person on two machines. Alice shares her identity with bob's machine,
# bob's machine takes hers: neither alone does anything, and once both are
# asked the two are one person with two devices. Either names a device; only
# the parent hands its part on or puts a device out.
source "$(dirname "$0")/lib.sh"
kill_all; fresh_logs; prep_profiles; testnet

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

echo "## D. a device is named from either machine"
BOBS=$(call $B "$SB" devices '{}' | grep 'this one' | sed 's/ — this one.*//')
wait_until "bob's machine names itself" "is now called laptop" call $B "$SB" set-device "{\"action\":\"name\",\"device\":\"$BOBS\",\"name\":\"laptop\"}"
wait_until "alice sees the name" "^laptop" call $A "$SA" devices '{}'

echo "## E. the parent's part: handed on by the parent only, then the old parent can be put out"
ALICES=$(call $A "$SA" devices '{}' | grep 'this one' | sed 's/ — this one.*//')
expect "bob's machine cannot put the parent out" "$(call $B "$SB" set-device "{\"action\":\"put-out\",\"device\":\"$ALICES\"}")" "is the parent"
expect "alice hands it on" "$(call $A "$SA" set-device '{"action":"hand-over","device":"laptop"}')" "laptop is the parent now"
wait_until "bob's machine is the parent" "this one — parent" call $B "$SB" devices '{}'
expect "alice no longer shares" "$(call $A "$SA" share-identity '{"person":"bob"}')" "only the parent device"
wait_until "the new parent puts the old one out" "no longer one of your user's devices" call $B "$SB" set-device "{\"action\":\"put-out\",\"device\":\"$ALICES\"}"
wait_until "…and has one device left" "^1$" count_devices $B "$SB"

echo "## F. it holds over a restart"
stop bob; start bob; SB=$(mcp $B)
wait_until "bob's machine is still the parent" "this one — parent" call $B "$SB" devices '{}'

kill_all
summary
