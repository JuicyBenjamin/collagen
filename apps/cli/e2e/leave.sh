#!/bin/bash
# Leaving a room: it disappears from the list and the profile file, focus moves
# to a remaining room, and the last room can't be left. alice alone is enough.
source "$(dirname "$0")/lib.sh"
kill_all; fresh_logs; prep_profiles; testnet
start alice
SA=$(mcp $A)
expect "two rooms to begin with" "$(call $A "$SA" list-rooms '{}')" "rooms\[2\]"
expect "leaving 'work' works" "$(call $A "$SA" leave-room '{"room":"work"}')" 'left .*work.* \[6f056449\]'
expect "one room left, and it is the one looked at" "$(call $A "$SA" list-rooms '{}')" "rooms\[1\].*dev room,[0-9]+,[0-9]+,true"
expect "the profile file forgot it" "$(python3 -c "import json; print([r['name'] for r in json.load(open('$CFG/identity-alice-$SCN.json'))['rooms']])")" "^\['dev room'\]$"
expect "the last room cannot be left" "$(call $A "$SA" leave-room '{"room":"dev room"}')" "cannot leave your only room"
kill_all; summary
