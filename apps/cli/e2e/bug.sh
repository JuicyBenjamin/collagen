#!/bin/bash
# A BUG ticket: the symptom is the one fact, the rest is the reporter's
# reading. alice reports one to nobody; bob's agent is handed the symptom
# alone until bob has given his own diagnosis (the blind first take on a
# bug); then the reporter's cause, importance and remedy open, with the score
# anchored in words. alice amends the report a field at a time — what she
# leaves out keeps its value. Judging the bug assigns nothing: the settle
# points at the plan or the fix's review that would name the bug in `from`.
# No CLI runs.
source "$(dirname "$0")/lib.sh"
kill_all; fresh_logs; prep_profiles; testnet
python3 -c 'import json,sys; json.dump({"preferredAi":None,"rooms":{"st-test3":[{"id":"b-sandbox","name":"sandbox","path":sys.argv[2]}]}}, open(sys.argv[1]+"/state-bob-"+sys.argv[3]+".json","w"))' "$CFG" "$OUT/sandbox" "$SCN"
start alice; start bob
SA=$(mcp $A); wait_for_peer $A "$SA" bob; SB=$(mcp $B); admitted bob

echo "## a bug is its symptom"
NOSYM='{"project":"sandbox","cause":{"what":"x"}}'
J1="$NOSYM"  # built first: bash 3.2 mangles \" nested in "$( )"
expect "no symptom: refused, told it is the one thing a report always has" "$(call $A "$SA" report-bug "$J1")" "failed: pass the symptom"
NOEFFECT='{"project":"sandbox","symptom":"the export is empty","importance":{"score":3,"effect":""}}'
J2="$NOEFFECT"
expect "a score without its effect in words is refused, with the anchor spelled out" "$(call $A "$SA" report-bug "$J2")" "importance needs the effect in words beside the score .3 means .{1,3}wrong"
BUG='{"project":"sandbox","symptom":"The export comes back empty for customers with more than 10k rows. Smaller ones are fine.","importance":{"score":4,"effect":"the two biggest customers cannot export at all"},"cause":{"what":"the cursor page size overflows the query planner limit","where":["apps/api/src/export.ts:88"]},"suggestion":{"what":"page by id, not by offset","requirements":["must stay under the 30s request budget"]},"remedy":"system"}'
J3="$BUG"
FILED=$(call $A "$SA" report-bug "$J3")
expect "filed as a bug, in the room, nobody asked" "$FILED" "bug ticket filed, in the room, nobody asked"
expect "…reported as a bug, nothing more" "$FILED" "TELL YOUR USER ONLY THIS: .{1,3}bug ticket has been filed"
BID=$(echo "$FILED" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
ROWS=$(rows $A "$SA" "$BID")
expect "the ticket knows it is a bug" "$ROWS" "kind: bug"
expect "the goal defaulted to the symptom's first sentence" "$ROWS" "goal: .{0,3}The export comes back empty for customers with more than 10k rows\."

echo "## bob's side: the symptom alone, until he has a diagnosis of his own"
wait_until "bob sees the bug" "kind: bug" rows $B "$SB" "$BID"
BLIND=$(call $B "$SB" review-context "{\"ticketId\":\"$BID\"}")
expect "review-context hands bob's agent the symptom" "$BLIND" "symptom: The export comes back empty"
expect "…and says it is the blind first take, a diagnosis of his own first" "$BLIND" "blind first take.*THEY make of the symptom"
expect "…and not the reporter's cause" "$(echo "$BLIND" | grep -c 'query planner')" "^0$"
TAKE="{\"ticketId\":\"$BID\",\"findings\":\"smells like the offset pagination; I would check the planner limit\"}"
call $B "$SB" post-review "$TAKE" > /dev/null
wait_until "bob's take is on the ticket" "review-bob,bob,take,settled" rows $A "$SA" "$BID"
FULL=$(call $B "$SB" review-context "{\"ticketId\":\"$BID\"}")
expect "now the reporter's reading opens: the cause" "$FULL" "cause: the cursor page size overflows"
expect "…and where" "$FULL" "where: .{0,3}apps/api/src/export.ts:88"
expect "…the score with its anchor in words" "$FULL" "importance: .{0,3}4 .{1,3} blocking"
expect "…and the effect" "$FULL" "effect: the two biggest customers"
expect "…the suggestion" "$FULL" "suggestion: .{0,3}page by id"
expect "…with its loose requirements" "$FULL" "requirements: must stay under the 30s request budget"
expect "…and the remedy, named" "$FULL" "remedy: .{0,3}system .{1,3} an existing system does the wrong thing"
ABOUT=$(call $B "$SB" review-context "{\"ticketId\":\"$BID\",\"about\":\"planner\"}")
expect "asking about a word in the report finds the report" "$ABOUT" "cause: the cursor page size overflows"
expect "…and the match line says the report matched" "$ABOUT" "the bug report matched"
NOPE=$(call $B "$SB" review-context "{\"ticketId\":\"$BID\",\"about\":\"zebra\"}")
expect "asking about a word nowhere in it says so" "$NOPE" "nothing in the why mentions .{0,3}zebra"

echo "## the report grows a field at a time — what alice leaves out keeps its value"
AMEND="{\"ticketId\":\"$BID\",\"cause\":{\"what\":\"the planner falls back to a full scan above 10k rows and the request times out\",\"where\":[\"apps/api/src/export.ts:88\",\"apps/api/src/db.ts:12\"]},\"remedy\":\"line\"}"
expect "the amendment is an update, not a new ticket" "$(call $A "$SA" report-bug "$AMEND")" "bug ticket updated"
AFTER=$(call $A "$SA" review-context "{\"ticketId\":\"$BID\"}")
expect "the cause is the new one" "$AFTER" "cause: the planner falls back to a full scan"
expect "…the remedy moved to a line fix" "$AFTER" "remedy: .{0,3}line .{1,3} a local fix"
expect "…and the importance alice did not mention is still there" "$AFTER" "importance: .{0,3}4 .{1,3} blocking"
NOTHING="{\"ticketId\":\"$BID\"}"
expect "an amendment that says nothing is refused" "$(call $A "$SA" report-bug "$NOTHING")" "failed: nothing to amend"

echo "## judging the bug assigns nothing: the next step names it in from"
SETTLE="{\"ticketId\":\"$BID\",\"stepId\":\"address\",\"result\":\"agreed: a line fix in export.ts, then a review\"}"
SETTLED=$(call $A "$SA" settle-step "$SETTLE")
expect "the settle points at a plan or the fix's review with from" "$SETTLED" "names this bug in from"
expect "…and says judging assigns nothing" "$SETTLED" "Judging the bug assigns nothing"
D1='{"what":"page by id","userWhy":"the bug report said the offset pagination overflows the planner","where":["apps/api/src/export.ts:88"]}'
FIX="{\"peers\":[\"bob\"],\"project\":\"sandbox\",\"goal\":\"export: page by id\",\"summary\":\"the export pages by id, so big customers export again\",\"decisions\":[$D1],\"forks\":[],\"from\":[\"$BID\"]}"
REVIEW=$(call $A "$SA" ask-review "$FIX")
expect "the fix's review is filed, asked of bob" "$REVIEW" "review ticket filed, asked of bob"
RID=$(echo "$REVIEW" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
expect "…and it names the bug it came from" "$(rows $A "$SA" "$RID")" "from: $BID"
kill_all; summary
