#!/bin/bash
# The human gate: an agent's send-to-peer / create-ticket does not leave the
# machine — it waits for the person's approval. alice runs without the e2e
# bypass here (no ai set = a person with no agent, still a person); bob is a
# mock and keeps auto-approving, which is how his replies get out at all.
source "$(dirname "$0")/lib.sh"
kill_all; fresh_logs; prep_profiles; testnet
start bob; COLLAGEN_AUTO_APPROVE=0 start alice
SA=$(mcp $A); wait_for_peer $A "$SA" bob; admitted bob

echo "## alice's agent tries to message bob"
OUT1=$(call $A "$SA" send-to-peer '{"peer":"bob","project":"sandbox","intent":"ask","findings":"is this gated?"}')
expect "the tool answers: queued for the person's approval" "$OUT1" "queued for your user's approval"
expect "the tool tells the agent to stop, not to work around it" "$OUT1" "do not resend"
echo "## alice's agent tries to open a ticket"
OUT2=$(call $A "$SA" create-ticket '{"goal":"explain average()","project":"sandbox","steps":[{"id":"s1","owner":"bob","intent":"investigate","description":"what does average() do"}]}')
expect "create-ticket is gated the same way" "$OUT2" "queued for your user's approval"
sleep 3 # a negative: give anything that would leak time to arrive
expect "nothing reached bob" "$(grep -c '← alice' "$OUT/bob.log")" "^0$"
expect "bob's log has no ticket" "$(call $B "$(mcp $B)" get-tickets '{}')" "tickets: \[\]|^$|tickets:$"
expect "alice's log shows both waiting in the outbox" "$(grep -c 'outbox: .* awaiting your approval' "$OUT/alice.log")" "^2$"
expect "a mock (bob) is not gated: drive makes him send at once" "$(call $A "$SA" drive-peer '{"peer":"bob","action":{"kind":"send-message","project":"sandbox","intent":"hello","findings":"from a mock"}}')" "drive sent"
wait_until "bob's message arrives at alice (mocks bypass the gate)" ",bob,sandbox," call $A "$SA" pending-threads '{}'

echo "## alice restarts: what waited still waits"
stop alice; COLLAGEN_AUTO_APPROVE=0 start alice
wait_until "both proposals survived the restart" "2 proposal\(s\) still waiting" cat "$OUT/alice.log"
kill_all; summary
