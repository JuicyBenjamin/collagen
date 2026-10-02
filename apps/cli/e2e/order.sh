#!/bin/bash
# Tickets in order: alice files two stacked reviews and puts the second
# `after` the first. Until the first is answered — bob's review AND alice's
# own address step — bob is not shown the second at all: not in get-tickets,
# not in review-context, no step delivered, and posting on it is refused as
# if it were not there. alice sees it, waiting. An order that would hide a
# ticket for good is refused: an unknown id, the ticket itself, a cycle. A
# review whose base is another open review's branch gets the order pointed
# out, never set. When alice addresses the first, the second opens to bob by
# itself and his step arrives. No CLI runs.
source "$(dirname "$0")/lib.sh"
kill_all; fresh_logs; prep_profiles; testnet
# bob has NO ai: a mock would post his review for him the moment a step arrived
python3 -c 'import json,sys; json.dump({"preferredAi":None,"rooms":{"st-test3":[{"id":"b-sandbox","name":"sandbox","path":sys.argv[2]}]}}, open(sys.argv[1]+"/state-bob-"+sys.argv[3]+".json","w"))' "$CFG" "$OUT/sandbox" "$SCN"
start alice; start bob
SA=$(mcp $A); wait_for_peer $A "$SA" bob; SB=$(mcp $B); admitted bob
ID_RE='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
D='{"title":"The change","what":"the change","userWhy":"she asked for it"}'

echo "## two stacked reviews: the second waits on the first"
J="{\"title\":\"review the first\",\"peers\":[\"bob\"],\"project\":\"sandbox\",\"goal\":\"review the first\",\"branch\":\"feat/first\",\"base\":\"main\",\"summary\":\"the base of the stack\",\"decisions\":[$D],\"forks\":[]}"
FIRST=$(call $A "$SA" ask-review "$J" | grep -oE "$ID_RE" | head -1)
J="{\"title\":\"review the second\",\"peers\":[\"bob\"],\"project\":\"sandbox\",\"goal\":\"review the second\",\"branch\":\"feat/second\",\"base\":\"feat/first\",\"summary\":\"built on the first\",\"decisions\":[$D],\"forks\":[],\"after\":[\"$FIRST\"]}"
FILED=$(call $A "$SA" ask-review "$J")
SECOND=$(echo "$FILED" | grep -oE "$ID_RE" | head -1)
expect "filed in order, and the agent is told it waits" "$FILED" "waits on 1 ticket.*nobody but your user is shown it"
expect "alice sees the second, waiting on the first" "$(rows $A "$SA" "$SECOND")" "waitingOn: $FIRST"

echo "## bob is not shown the second"
wait_until "bob holds the first" "review the first" goals $B "$SB"
expect "get-tickets leaves it out" "$(call $B "$SB" get-tickets '{}' | grep -c 'review the second')" "^0$"
J="{\"ticketId\":\"$SECOND\"}"
expect "review-context: no such ticket" "$(call $B "$SB" review-context "$J")" "failed: no ticket $SECOND"
J="{\"ticketId\":\"$SECOND\",\"findings\":\"early\"}"
expect "post-review: no such ticket" "$(call $B "$SB" post-review "$J")" "failed: no ticket $SECOND"
wait_until "bob's step on the first arrived" ",alice,sandbox,[0-9]+," call $B "$SB" pending-threads '{}'
THREAD=$(call $B "$SB" pending-threads '{}' | grep -oE '[0-9a-f]{16}' | head -1)
JT="{\"threadId\":\"$THREAD\"}"
INBOX=$(call $B "$SB" get-messages "$JT")
expect "…the first's step is in his inbox" "$INBOX" "review the first"
expect "…and nothing of the second" "$(echo "$INBOX" | grep -c 'review the second')" "^0$"

echo "## an order that would hide a ticket for good is refused"
expect "an unknown id" "$(call $A "$SA" ask-plan '{"title":"phase two","project":"sandbox","goal":"phase two","summary":"after phase one","decisions":[{"title":"A","what":"a","userWhy":"b"}],"after":["no-such-ticket"]}')" "failed: no ticket no-such-ticket"
J="{\"ticketId\":\"$SECOND\",\"after\":[\"$SECOND\"]}"
expect "the ticket itself" "$(call $A "$SA" ask-review "$J")" "cannot wait on itself"
J="{\"ticketId\":\"$FIRST\",\"after\":[\"$SECOND\"]}"
expect "a cycle" "$(call $A "$SA" ask-review "$J")" "goes round in a circle"

echo "## a base that is another open review's branch: pointed out, not set"
J="{\"title\":\"review the third\",\"project\":\"sandbox\",\"goal\":\"review the third\",\"branch\":\"feat/third\",\"base\":\"feat/first\",\"summary\":\"also on the first\",\"decisions\":[$D],\"forks\":[]}"
THIRD_OUT=$(call $A "$SA" ask-review "$J")
expect "the outcome names the review it may follow, and asks first" "$THIRD_OUT" "base feat/first is the branch of the open review .{1,3}review the first.*ask them first; nothing was set"
wait_until "…and bob is shown it at once: nothing was set" "review the third" goals $B "$SB"

echo "## the first is answered: the second opens to bob by itself"
J="{\"ticketId\":\"$FIRST\",\"findings\":\"fine\"}"
expect "bob reviews the first" "$(call $B "$SB" post-review "$J")" "your review is on"
wait_until "alice holds bob's review" "review-bob,bob,review,settled" rows $A "$SA" "$FIRST"
expect "a reader's review alone does not open it: alice has not addressed the first" "$(call $B "$SB" get-tickets '{}' | grep -c 'review the second')" "^0$"
J="{\"ticketId\":\"$FIRST\",\"stepId\":\"address\",\"result\":\"done\"}"
expect "alice addresses the first" "$(call $A "$SA" settle-step "$J")" "Every step on this ticket is answered"
wait_until "bob is shown the second now" "review the second" goals $B "$SB"
wait_until "…and his step on it arrives" "review the second" call $B "$SB" get-messages "$JT"
expect "alice's copy no longer waits" "$(rows $A "$SA" "$SECOND" | grep -c waitingOn)" "^0$"

kill_all; summary
