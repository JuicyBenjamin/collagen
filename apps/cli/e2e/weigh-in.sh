#!/bin/bash
# Everyone a ticket concerns hears about it. alice creates a ticket bob owns;
# bob (mock) settles it — alice, the creator with no step of her own, gets a
# ticket-update on her thread with bob. Then carol (mock, not asked) weighs in
# on the ticket with a message to alice — bob, an owner but not the recipient,
# gets a "weighed in" update. Three peers, all mocks or headless: no CLI runs.
source "$(dirname "$0")/lib.sh"
kill_all; fresh_logs; prep_profiles; testnet
start alice; start bob; start carol --room st-test3; sleep 10
SA=$(mcp $A); wait_for_peer $A "$SA" bob; wait_for_peer $A "$SA" carol; sleep 2
# carol was created fresh: make her a mock so she can be driven (and never runs a CLI)
SC=$(mcp $C); call $C "$SC" set-ai '{"ai":"mock:codex"}' > /dev/null; sleep 3

echo "## a ticket bob owns; his mock settles it"
TICKET=$(call $A "$SA" create-ticket '{"goal":"weigh-in demo","project":"sandbox","steps":[{"id":"s1","owner":"bob","intent":"investigate","description":"bob looks"}]}' | grep -oE 'id: [0-9a-f-]{36}' | head -1 | cut -d' ' -f2)
expect "ticket created" "$TICKET" "^[0-9a-f-]{36}$"
wait_until "bob settled s1" "s1,bob,investigate,settled" call $A "$SA" get-tickets '{}'
wait_until "alice (creator, no step of her own) was told: bob settled" "^1$" grep -c "bob settled — telling your agent" "$OUT/alice.log"
expect "…as a ticket-update on her inbox" "$(call $A "$SA" pending-threads '{}')" "ticket-update:settled"

echo "## carol, not asked, weighs in — to alice, tagged with the ticket"
call $A "$SA" drive-peer "{\"peer\":\"carol\",\"action\":\"send-message\",\"project\":\"sandbox\",\"intent\":\"two-cents\",\"findings\":\"have you checked the loop bound?\",\"ticketId\":\"$TICKET\"}" | sed "s/^/  drive: /"
wait_until "alice got carol's message itself" "carol,sandbox,[0-9]+,two-cents" call $A "$SA" pending-threads '{}'
wait_until "bob (owner, not the recipient) was told: carol weighed in" "^1$" grep -c "carol weighed in — telling your agent" "$OUT/bob.log"
expect "carol shows as weighed in on the ticket for everyone (the message carries the ticket)" "$(call $A "$SA" get-messages "{\"threadId\":\"$(call $A "$SA" pending-threads '{}' | grep -oE '[0-9a-f]{16},carol' | head -1 | cut -d, -f1)\"}")" "ticketId"
kill_all; restore_profiles; summary
