#!/bin/bash
# Leaving a room: it disappears from the list and the profile file, focus moves
# to a remaining room, and the last room can't be left. alice alone is enough.
source "$(dirname "$0")/lib.sh"
kill_all; fresh_logs; prep_profiles; testnet
cp "$CFG/identity-alice.json" "$OUT/identity-alice.bak"
start alice; sleep 8
SA=$(mcp $A)
expect "two rooms to begin with" "$(call $A "$SA" list-rooms '{}')" "rooms\[2\]"
expect "leaving 'work' works" "$(call $A "$SA" leave-room '{"room":"work"}')" 'left .*work.* \[6f056449\]'
expect "one room left, and it is the one looked at" "$(call $A "$SA" list-rooms '{}')" "rooms\[1\].*dev room,[0-9]+,[0-9]+,true"
expect "the profile file forgot it" "$(python3 -c "import json,os; print([r['name'] for r in json.load(open(os.path.expanduser('~/.config/collagen/identity-alice.json')))['rooms']])")" "^\['dev room'\]$"
expect "the last room cannot be left" "$(call $A "$SA" leave-room '{"room":"dev room"}')" "cannot leave your only room"
kill_all; cp "$OUT/identity-alice.bak" "$CFG/identity-alice.json"; restore_profiles; summary
