#!/bin/bash
# Two instances started in the same instant find each other and greet within
# seconds on the local testnet. Prints each side's connection lifecycle.
source "$(dirname "$0")/lib.sh"
kill_all; fresh_logs; prep_profiles; testnet
start bob; start alice
SA=$(mcp $A); wait_for_peer $A "$SA" bob; admitted bob; await_log bob "peer online: alice"
for who in alice bob; do
  echo "--- $who"; grep -E "room open|swarm connection|peer online|room log|admit" "$OUT/$who.log" | cut -c12- | cut -c1-110
done
expect "alice saw bob online" "$(cat "$OUT/alice.log")" "peer online: bob"
expect "bob saw alice online" "$(cat "$OUT/bob.log")" "peer online: alice"
expect "bob was admitted to the room log" "$(cat "$OUT/bob.log")" "admitted to the room log"
echo "## a project a peer shares is located, not added"
SB=$(mcp $B)
wait_until "alice sees bob's projects" "backoffice" call $A "$SA" list-room '{}'
mkdir -p "$OUT/Backoffice"
J="{\"path\":\"$OUT/Backoffice\"}"
expect "alice's folder named like bob's project is his project, in the room's spelling" "$(call $A "$SA" add-project "$J")" "sharing .{1,3}backoffice.*you now share .{1,3}backoffice.{1,3} too, as bob does"
mkdir -p "$OUT/fresh"
J="{\"path\":\"$OUT/fresh\"}"
expect "a folder nobody shares is a project new to the room" "$(call $A "$SA" add-project "$J")" "sharing .{1,3}fresh.*a project new to the room"
wait_until "bob sees one backoffice, held by both" "backoffice" call $B "$SB" list-room '{}'
kill_all; summary
