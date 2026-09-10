#!/bin/bash
# The outbox: what an agent sends on its person's word goes out at once, and
# is remembered as having gone. There is no approval step — an agent only
# acts when asked, so approving your own request was theatre. alice has no ai
# (a person with no agent, still a person); bob is a mock.
source "$(dirname "$0")/lib.sh"
kill_all; fresh_logs; prep_profiles; testnet
start alice; start bob
SA=$(mcp $A); wait_for_peer $A "$SA" bob; SB=$(mcp $B); admitted bob

echo "## alice's agent sends, on her word"
OUT1=$(call $A "$SA" send-to-peer '{"peer":"bob","project":"sandbox","intent":"ask","findings":"does this go straight out?"}')
expect "the tool says what happened, not what might" "$OUT1" "sent to bob"
wait_until "bob has it" "^1$" grep -c '← alice \[sandbox/ask\]' "$OUT/bob.log"
expect "and it is recorded as having gone" "$(grep -c '↗ message → bob · sandbox · ask' "$OUT/alice.log")" "^1$"

echo "## a ticket, the same way"
OUT2=$(call $A "$SA" create-ticket '{"goal":"explain average()","project":"sandbox","steps":[{"id":"s1","owner":"bob","intent":"investigate","description":"what does average() do"}]}')
expect "create-ticket answers with the ticket itself" "$OUT2" "goal: explain average"
wait_until "bob sees it in the room" "explain average" goals $B "$SB"
expect "…and alice's outbox recorded it" "$(grep -c '↗ ticket → bob' "$OUT/alice.log")" "^1$"

echo "## the record survives a restart — the room's log is the truth, this is the receipt"
stop alice; start alice; SA=$(mcp $A)
wait_until "alice is back" "explain average" goals $A "$SA"
expect "her sent records are still in local state" "$(python3 -c "
import json,sys
s=json.load(open('$CFG/state-alice-$SCN.json'))
print(len(s.get('sent',[])), ','.join(p['outgoing']['kind'] for p in s.get('sent',[])))")" "^2 ticket,message$"

echo "## nothing is queued anywhere: no gate to get past"
expect "no proposal ever waited" "$(grep -c 'awaiting your approval' "$OUT/alice.log")" "^0$"
kill_all; summary
