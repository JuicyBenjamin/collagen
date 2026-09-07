#!/bin/bash
# Two instances started in the same instant find each other and greet within
# seconds on the local testnet. Prints each side's connection lifecycle.
source "$(dirname "$0")/lib.sh"
kill_all; fresh_logs; prep_profiles; testnet
start bob; start alice; sleep 8
for who in alice bob; do
  echo "--- $who"; grep -E "room open|swarm connection|peer online|room log|admit" "$OUT/$who.log" | cut -c12- | cut -c1-110
done
expect "alice saw bob online" "$(cat "$OUT/alice.log")" "peer online: bob"
expect "bob saw alice online" "$(cat "$OUT/bob.log")" "peer online: alice"
expect "bob was admitted to the room log" "$(cat "$OUT/bob.log")" "admitted to the room log"
kill_all; restore_profiles; summary
