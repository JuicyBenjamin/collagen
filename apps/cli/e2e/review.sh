#!/bin/bash
# Review tickets: the why travels with the code. alice's agent asks bob for a
# review and brings what a diff cannot show — the branch and the github link
# (read from the project's own git), a summary, the decisions with how alice
# steered each one, and the forks in the road with the file:line each produced.
# bob's side sees a review ticket and pulls the why on demand, whole or one
# part at a time. A review with no why is refused before anything leaves, and
# only the author writes their own why. No CLI runs.
source "$(dirname "$0")/lib.sh"
kill_all; fresh_logs; prep_profiles; testnet

echo "## alice's shared project is a repo, on a branch, with an origin"
mkdir -p "$OUT/sandbox/.git"
printf 'ref: refs/heads/feat/opening-animation\n' > "$OUT/sandbox/.git/HEAD"
printf '[core]\n\tbare = false\n[remote "origin"]\n\turl = git@github.com:JuicyBenjamin/collagen.git\n' > "$OUT/sandbox/.git/config"

# carol is a mock here too, so she can be driven as a second reader
# (prep_profiles writes alice and bob only)
python3 -c 'import json,sys; json.dump({"preferredAi":"mock:codex","rooms":{"st-test3":[{"id":"c-sandbox","name":"sandbox","path":sys.argv[2]}]}}, open(sys.argv[1]+"/state-carol-"+sys.argv[3]+".json","w"))' "$CFG" "$OUT/sandbox" "$SCN"
# alice first: she creates this room's log. A peer joining with --room before
# the creator is up creates a log of its own, and the room splits (two logs,
# both populated, neither yields) — see three-members.sh for the same order.
start alice; start bob; start carol --room st-test3
SA=$(mcp $A); wait_for_peer $A "$SA" bob; wait_for_peer $A "$SA" carol; SB=$(mcp $B); SC=$(mcp $C); admitted bob; admitted carol

echo "## a review with no why is refused before anything leaves"
NOWHY='{"peers":["bob"],"project":"sandbox","summary":"the opening animation","decisions":[],"forks":[]}'
expect "no decisions: refused, and told to mine the conversation" "$(call $A "$SA" ask-review "$NOWHY")" "failed: pass the decisions behind the change"
BADWHY='{"peers":["bob"],"project":"sandbox","summary":"x","decisions":[{"what":"pure frame functions"}],"forks":[]}'
expect "a decision with no why at all: refused, naming which" "$(call $A "$SA" ask-review "$BADWHY")" "decision 1 .{1,3}pure frame functions.{1,3} has no why"
NOPROJ='{"peers":["bob"],"project":"nope","summary":"x","decisions":[{"what":"a","userWhy":"b"}],"forks":[]}'
expect "a project alice does not share: refused with what she does share" "$(call $A "$SA" ask-review "$NOPROJ")" "not a project your user shares in this room .{0,10}theirs: sandbox"
NOPEER='{"peers":["kristian"],"project":"sandbox","summary":"x","decisions":[{"what":"a","userWhy":"b"}],"forks":[]}'
expect "someone who is not in the room: refused" "$(call $A "$SA" ask-review "$NOPEER")" "no peer named kristian"

echo "## the ask: alice's steering, her agent's reasons, and the fork it took"
D1='{"what":"pure frame functions for the logo","userWhy":"she said make it look cool, and was fine with a longer boot for it","agentWhy":"a frame is then testable without a terminal","where":["src/lib/logoFrame.ts:60"]}'
D2='{"what":"a fast boot is still held until the sweep is seen","userWhy":"collagen first in the middle, the tagline below, then it animates to its place","where":["src/lib/opening.ts:14"]}'
F1='{"at":"src/components/Logo/Logo.tsx:87","chose":"setInterval at 30 fps","instead":"the Timeline animator in @opentui/core","why":"no new dependency and the frame stays pure","by":"agent"}'
ASK="{\"peers\":[\"bob\"],\"project\":\"sandbox\",\"base\":\"main\",\"focus\":\"the timing constants\",\"summary\":\"the opening animation: the logo starts centred and glides into the header\",\"decisions\":[$D1,$D2],\"forks\":[$F1]}"
ASKED=$(call $A "$SA" ask-review "$ASK")
expect "ask-review files the ticket and says it asks bob" "$ASKED" "review ticket filed, asked of bob"
expect "…the counts are there for the agent, marked as not for the person" "$ASKED" "2 decision\(s\), 1 fork\(s\) now on it — for your own bookkeeping, not for your user"
expect "…and it says what to report: that the ticket was filed, nothing else" "$ASKED" "TELL YOUR USER ONLY THIS: .{1,3}review ticket has been filed"
TICKET=$(echo "$ASKED" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)

echo "## bob's side: a review ticket whose headline says where the code is"
wait_until "bob sees it, named for the branch alice is on" "review feat/opening-animation" goals $B "$SB"
TICKETS=$(call $B "$SB" get-tickets '{}')
expect "the ticket knows it is a review" "$TICKETS" "kind: review"
expect "…the branch off main and the link, read from alice's repo — she passed neither" "$TICKETS" "feat/opening-animation .{1,6} main.{1,20}github.com/JuicyBenjamin/collagen/tree/feat/opening-animation"
expect "…and the listing carries the headline, not the why itself" "$TICKETS" "2 decisions .{1,6} 1 fork"
expect "…bob's step says to read the why only when his person asks" "$TICKETS" "review-context .{1,3}ticketId.{1,3} when your person asks"
expect "…and what alice wants looked at" "$TICKETS" "the timing constants"

echo "## the why, on demand"
WHY=$(call $B "$SB" review-context "{\"ticketId\":\"$TICKET\"}")
expect "what alice asked for, in her words" "$WHY" "she said make it look cool"
expect "what her agent reasoned" "$WHY" "testable without a terminal"
expect "where the decision landed" "$WHY" "src/lib/logoFrame.ts:60"
expect "the fork: the road taken, the road not taken, and why" "$WHY" "setInterval at 30 fps.*Timeline animator.*no new dependency"
expect "…with the file:line the choice produced" "$WHY" "src/components/Logo/Logo.tsx:87"

ABOUT=$(call $B "$SB" review-context "{\"ticketId\":\"$TICKET\",\"about\":\"opening.ts\"}")
expect "one part at a time: only the decision about that file" "$ABOUT" "collagen first in the middle"
expect "…and not the others" "$(echo "$ABOUT" | grep -c 'make it look cool')" "^0$"
expect "…it says how much of the review that was" "$ABOUT" "1 of 2 decisions, 0 of 1 forks"
expect "asking about something the why never mentions says so" "$(call $B "$SB" review-context "{\"ticketId\":\"$TICKET\",\"about\":\"the database\"}")" "nothing in the why mentions .{1,3}the database"

echo "## a plain ticket has no why to read"
OTHER=$(call $A "$SA" create-ticket '{"goal":"why does the render flicker","project":"sandbox","steps":[{"id":"s1","owner":"bob","intent":"investigate","description":"look at the frame"}]}')
OID=$(echo "$OTHER" | grep -oE 'id: [0-9a-f-]{36}' | head -1 | cut -d' ' -f2)
wait_until "bob sees the plain ticket too" "flicker" goals $B "$SB"
expect "review-context says it is not a review ticket" "$(call $B "$SB" review-context "{\"ticketId\":\"$OID\"}")" "is not a review ticket"

echo "## the why grows as the work does — and only its author writes it"
AMEND_BOB="{\"ticketId\":\"$TICKET\",\"decisions\":[{\"what\":\"bob's own idea\",\"agentWhy\":\"mine\"}]}"
expect "bob cannot write alice's why (his reading goes to her as a message)" "$(call $B "$SB" ask-review "$AMEND_BOB")" "is alice's to write"
AMEND="{\"ticketId\":\"$TICKET\",\"link\":\"https://github.com/JuicyBenjamin/collagen/pull/23\",\"decisions\":[{\"what\":\"the sheen sweeps until the app is up\",\"userWhy\":\"she asked for the wait to look intentional, not stuck\",\"where\":[\"src/lib/logoFrame.ts:74\"]}]}"
AMENDED=$(call $A "$SA" ask-review "$AMEND")
expect "alice adds a third decision" "$AMENDED" "review ticket updated .*3 decision\(s\)"
expect "…reported as updated, with the contents left off" "$AMENDED" "TELL YOUR USER ONLY THIS: .{1,3}review ticket has been updated"
expect "…and the outcome itself says to come back when the code moves" "$AMENDED" "call ask-review again with ticketId"
wait_until "bob sees it, and the link is the pull request now" "look intentional, not stuck" call $B "$SB" review-context "{\"ticketId\":\"$TICKET\"}"
expect "…the pull request link replaced the branch link" "$(call $B "$SB" review-context "{\"ticketId\":\"$TICKET\"}")" "pull/23"
FIX="{\"ticketId\":\"$TICKET\",\"decisions\":[{\"id\":\"d1\",\"what\":\"pure frame functions for the logo\",\"userWhy\":\"she said make it look cool, and later: fine if it takes longer for animation\",\"where\":[\"src/lib/logoFrame.ts:60\"]}]}"
expect "a correction by id replaces the decision, it does not pile up" "$(call $A "$SA" ask-review "$FIX")" "review ticket updated .*3 decision\(s\)"
wait_until "bob reads the corrected words" "fine if it takes longer for animation" call $B "$SB" review-context "{\"ticketId\":\"$TICKET\"}"
expect "an amendment with nothing in it is refused" "$(call $A "$SA" ask-review "{\"ticketId\":\"$TICKET\"}")" "nothing to amend"

echo "## 0 reviewers: the ticket sits in the room with the why on it"
OPEN_D='{"what":"the sheen is a gaussian band, not a gradient sweep","userWhy":"he asked for it to look cool","where":["src/lib/logoFrame.ts:74"]}'
OPEN_ASK="{\"project\":\"sandbox\",\"goal\":\"review the sheen\",\"summary\":\"the sheen that sweeps while the app boots\",\"decisions\":[$OPEN_D],\"forks\":[]}"
OPENED=$(call $A "$SA" ask-review "$OPEN_ASK")
expect "no peers named: it goes to the room, nobody in particular" "$OPENED" "review ticket filed, in the room, nobody asked in particular"
expect "…opening one says how to keep it current, where an agent will read it" "$OPENED" "call ask-review again with ticketId"
OPEN_TICKET=$(echo "$OPENED" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
wait_until "bob sees it in the room" "review the sheen" goals $B "$SB"
OPEN_ROWS=$(rows $B "$SB" "$OPEN_TICKET")
expect "there is no review step yet: a step exists when a person has something on it" "$OPEN_ROWS" "steps\[1\]"
expect "…only the author's own step, which is how the ticket finishes" "$OPEN_ROWS" "address,alice,address,(pending|suspended)"
expect "bob's agent can read the why of a review nobody addressed to him" "$(call $B "$SB" review-context "{\"ticketId\":\"$OPEN_TICKET\"}")" "gaussian band"
# bob runs a mock: anything DELIVERED to him is settled at once. Nothing is.
sleep 2
expect "nothing was pushed to bob" "$(grep -c "ticket ${OPEN_TICKET:0:8}.*actionable" "$OUT/bob.log")" "^0$"
expect "…nor to carol" "$(grep -c "ticket ${OPEN_TICKET:0:8}.*actionable" "$OUT/carol.log")" "^0$"

echo "## a reader posts their review — it is theirs, and takes nothing"
wait_until "bob holds the ticket (a drive needs him to hold it)" "review the sheen" goals $B "$SB"
BOB_POSTS="{\"peer\":\"bob\",\"action\":{\"kind\":\"post-review\",\"ticketId\":\"$OPEN_TICKET\",\"result\":\"bob read it: the band is right, the period is long\"}}"
drive_until "bob's review lands on a step of his own" "review-bob,bob,review,settled" $A "$SA" "$BOB_POSTS" rows $A "$SA" "$OPEN_TICKET"
expect "…and the author's step is still the author's to settle" "$(rows $A "$SA" "$OPEN_TICKET")" "address,alice,address,(pending|suspended)"

wait_until "carol holds it too" "review the sheen" goals $C "$SC"
CAROL_POSTS="{\"peer\":\"carol\",\"action\":{\"kind\":\"post-review\",\"ticketId\":\"$OPEN_TICKET\",\"result\":\"carol read it too: the period could be shorter\"}}"
drive_until "carol reviews the same change, beside bob" "review-carol,carol,review,settled" $A "$SA" "$CAROL_POSTS" rows $A "$SA" "$OPEN_TICKET"
expect "…bob's review is untouched by hers" "$(rows $A "$SA" "$OPEN_TICKET")" "the band is right"

BOB_AGAIN="{\"peer\":\"bob\",\"action\":{\"kind\":\"post-review\",\"ticketId\":\"$OPEN_TICKET\",\"result\":\"bob again: on second read the sheen is fine\"}}"
drive_until "posting again revises his own review" "on second read" $A "$SA" "$BOB_AGAIN" rows $A "$SA" "$OPEN_TICKET"
expect "…still one step per reader: his own, revised" "$(rows $A "$SA" "$OPEN_TICKET")" "steps\[3\]"

echo "## a step belongs to whoever owns it, and the author's step finishes the ticket"
expect "post-review on a plain ticket is refused" "$(call $B "$SB" post-review "{\"ticketId\":\"$OID\",\"findings\":\"x\"}")" "is not a review ticket"
expect "alice settles her own step: the ticket is done" "$(call $A "$SA" settle-step "{\"ticketId\":\"$OPEN_TICKET\",\"stepId\":\"address\",\"result\":\"got what I needed, thanks both\"}")" "address,alice,address,settled"
# NOT asserted: that bob's copy shows her step settled within a minute. It
# usually does and sometimes takes longer — view convergence between three
# writers is its own thing (see the lag notes in the README), and the ticket
# rules are covered above and in the unit tests.

echo "## many reviewers: one review step each, and the author waits on all"
MANY_D='{"what":"one evict entry per sweep","userWhy":"he said never brick, migrate instead","where":["packages/p2p/src/RoomLog.ts:1"]}'
MANY_ASK="{\"peers\":[\"bob\",\"carol\"],\"project\":\"sandbox\",\"goal\":\"review the migration\",\"summary\":\"records from an older protocol are evicted, not carried\",\"decisions\":[$MANY_D],\"forks\":[]}"
MANY=$(call $A "$SA" ask-review "$MANY_ASK")
expect "both are asked" "$MANY" "review ticket filed, asked of bob, carol"
MANY_TICKET=$(echo "$MANY" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
wait_until "each reviewer got a step of their own, named for them" "review-bob,bob" rows $A "$SA" "$MANY_TICKET"
MANY_ROWS=$(rows $A "$SA" "$MANY_TICKET")
expect "…carol's too" "$MANY_ROWS" "review-carol,carol"
expect "…and the author's step waits on both" "$MANY_ROWS" "address,alice,address,pending,review-bob\+review-carol"
expect "a name nobody in the room has is refused, with the open option offered" "$(call $A "$SA" ask-review "{\"peers\":[\"bob\",\"nobody\"],\"project\":\"sandbox\",\"summary\":\"x\",\"decisions\":[{\"what\":\"a\",\"userWhy\":\"b\"}],\"forks\":[]}")" "no peer named nobody.*leave .peers. out"

echo "## uninvited readers are welcome on a review ticket, and take nobody's step"
wait_until "carol holds the many-reviewer ticket" "review the migration" goals $C "$SC"
CAROL_UNASKED="{\"peer\":\"carol\",\"action\":{\"kind\":\"post-review\",\"ticketId\":\"$MANY_TICKET\",\"result\":\"carol, unasked: the eviction key guard is the good bit\"}}"
drive_until "carol's review lands as hers" "carol, unasked" $A "$SA" "$CAROL_UNASKED" rows $A "$SA" "$MANY_TICKET"
expect "…bob's own step is still bob's" "$(rows $A "$SA" "$MANY_TICKET")" "review-bob,bob,review"
expect "settling someone else's step is refused, with what to do instead" "$(call $B "$SB" settle-step "{\"ticketId\":\"$MANY_TICKET\",\"stepId\":\"address\",\"result\":\"not mine\"}")" "is alice.s to settle.*post-review"

echo "## a reviewer who was asked and wants changes hands the ticket back to its author"
BOB_CHANGES="{\"peer\":\"bob\",\"action\":{\"kind\":\"post-review\",\"ticketId\":\"$MANY_TICKET\",\"result\":\"bob: the evict entry needs the protocol version in it\",\"failed\":true}}"
drive_until "bob asks for changes on his own step" "review-bob,bob,review,failed" $A "$SA" "$BOB_CHANGES" rows $A "$SA" "$MANY_TICKET"
wait_until "the author's own step is handed to her — a change request is an answer, not a dead end" "ticket .{1,10} step address actionable" bash -c "cat '$OUT/alice.log'"
wait_until "carol, the other reader, hears it as a change request" "bob asked for changes" bash -c "cat '$OUT/carol.log'"
expect "…and nobody is told bob failed" "$(grep -c 'bob failed' "$OUT/carol.log")" "^0$"

echo "## the ticket keeps up with the code: a revision reaches its readers"
REV="{\"ticketId\":\"$MANY_TICKET\",\"branch\":\"feat/evict-v2\",\"link\":\"https://github.com/JuicyBenjamin/collagen/pull/24\",\"decisions\":[{\"what\":\"the sweep is per read, not per open\",\"userWhy\":\"he asked after bob's read: never brick\",\"where\":[\"packages/p2p/src/RoomLog.ts:150\"]}]}"
expect "alice revises the why after the reviews" "$(call $A "$SA" ask-review "$REV")" "review ticket updated .*2 decision\(s\)"
wait_until "bob is told the why moved, on the thread he knows the ticket by" "revised the why" bash -c "cat '$OUT/bob.log'"
expect "…and it is the ticket he already knows, not a new one" "$(grep 'revised the why' "$OUT/bob.log" | tail -1)" "ticket ${MANY_TICKET:0:8}"
expect "…carol too" "$(grep -c 'revised the why' "$OUT/carol.log")" "^[1-9]"
WHY_NOW=$(call $B "$SB" review-context "{\"ticketId\":\"$MANY_TICKET\"}")
expect "reading it again gives the current why" "$WHY_NOW" "per read, not per open"
expect "…the new branch and pull request" "$WHY_NOW" "feat/evict-v2.*pull/24"
expect "…and when it was last revised" "$WHY_NOW" "updated: .{0,3}2026"

echo "## it outlives the connection: bob reads the why with alice gone"
stop alice
expect "the why is on the room's log, not fetched from alice" "$(call $B "$SB" review-context "{\"ticketId\":\"$TICKET\"}")" "she said make it look cool"
kill_all; summary
