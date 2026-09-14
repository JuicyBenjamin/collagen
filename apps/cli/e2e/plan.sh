#!/bin/bash
# Plans and proposals: judgment before the code exists. alice puts a PLAN to
# the room — the question everyone sees, her thoughts and her agent's insight
# behind it. bob's agent is handed the question alone until bob has posted his
# own take (the blind first take); his ↻ hands the plan back to alice, who
# revises the same ticket; his ✓ answers it; the settle that finishes it only
# OFFERS the close; alice closes with the conclusion as the reason and gets
# her when-closed instruction back at that moment, not before. Then a
# PROPOSAL to bob: his take ✓ is what starts the work steps he owns. A task
# that follows the plan names it with `from`. No CLI runs.
source "$(dirname "$0")/lib.sh"
kill_all; fresh_logs; prep_profiles; testnet
# bob has NO ai here: a mock settles every step handed to it, which would post
# his take for him before he had one — the blind first take needs a person
python3 -c 'import json,sys; json.dump({"preferredAi":None,"rooms":{"st-test3":[{"id":"b-sandbox","name":"sandbox","path":sys.argv[2]}]}}, open(sys.argv[1]+"/state-bob-"+sys.argv[3]+".json","w"))' "$CFG" "$OUT/sandbox" "$SCN"
start alice; start bob
SA=$(mcp $A); wait_for_peer $A "$SA" bob; SB=$(mcp $B); admitted bob

echo "## a plan needs a question, and is not a review"
NOGOAL='{"peers":["bob"],"project":"sandbox","summary":"x","decisions":[{"what":"a","userWhy":"b"}],"forks":[]}'
J1="$NOGOAL"  # built first: bash 3.2 mangles \" nested in "$( )"
R1=$(call $A "$SA" ask-plan "$J1")
expect "no goal: refused, told what the goal is" "$R1" "failed: pass .goal. .{1,6} the one line everyone sees: what your user intends to do"
T1='{"what":"stream the rows instead of buffering the whole export","userWhy":"he said the backoffice export times out on big customers","agentWhy":"a cursor over the query keeps memory flat; the CSV writer already streams","where":["apps/api/src/export.ts"]}'
F1='{"at":"apps/api/src/export.ts","chose":"paginate the query by id","instead":"one big query with a streaming driver","why":"the driver we have does not stream; pagination needs nothing new","by":"agent"}'
PLAN="{\"peers\":[\"bob\"],\"project\":\"sandbox\",\"goal\":\"stream the export, do not buffer it\",\"summary\":\"the export should stream rows to the client as they are read\",\"decisions\":[$T1],\"forks\":[$F1],\"whenClosed\":\"open a Jira ticket for the export work\"}"
FILED=$(call $A "$SA" ask-plan "$PLAN")
expect "filed as a plan, asked of bob" "$FILED" "plan ticket filed, asked of bob"
expect "…reported as a plan, nothing more" "$FILED" "TELL YOUR USER ONLY THIS: .{1,3}plan ticket has been filed"
PID=$(echo "$FILED" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)

echo "## bob's side: the question, and a take step of his own — the thoughts wait"
wait_until "bob sees the plan" "kind: plan" rows $B "$SB" "$PID"
ROWS=$(rows $B "$SB" "$PID")
expect "the ticket knows it is a plan" "$ROWS" "kind: plan"
expect "bob's step is a take, not a review" "$ROWS" "review-bob,bob,take"
expect "…and it says: your person's own take first, then the thoughts" "$ROWS" "Ask your person for THEIR OWN take FIRST"
expect "the when-closed line is on the ticket for everyone to see" "$ROWS" "whenClosed: open a Jira ticket for the export work"
BLIND=$(call $B "$SB" review-context "{\"ticketId\":\"$PID\"}")
expect "review-context hands bob's agent the question alone until bob has taken a position" "$BLIND" "blind first take"
expect "…not the thoughts" "$(echo "$BLIND" | grep -c 'times out on big customers')" "^0$"
J2="{\"ticketId\":\"$PID\",\"anyway\":true}"  # built first: bash 3.2 mangles \" nested in "$( )"
R2=$(call $B "$SB" review-context "$J2")
expect "…unless bob asks to see it all, and his agent says so" "$R2" "times out on big customers"

echo "## bob's take: changes — the plan comes back to alice"
TAKE=$(call $B "$SB" post-review "{\"ticketId\":\"$PID\",\"findings\":\"pagination by id breaks on the composite key; page by cursor\",\"failed\":true}")
expect "his take lands on his own step, as a take" "$TAKE" "your take is on .{1,3}stream the export"
J3="{\"ticketId\":\"$PID\"}"  # built first: bash 3.2 mangles \" nested in "$( )"
R3=$(call $B "$SB" review-context "$J3")
expect "now the thoughts open to him" "$R3" "times out on big customers"
wait_until "alice's side: bob asked for changes, in those words" "bob asked for changes" bash -c "cat '$OUT/alice.log'"
expect "alice's address step is not up: a ↻ on a plan means revise, not act" "$(rows $A "$SA" "$PID")" "answered: false"
AMEND="{\"ticketId\":\"$PID\",\"goal\":\"stream the export, paged by cursor\",\"summary\":\"stream rows, paged by cursor not by id\",\"decisions\":[{\"id\":\"d1\",\"what\":\"stream the rows, paged by cursor\",\"userWhy\":\"he said the backoffice export times out on big customers\",\"agentWhy\":\"bob is right that the id is composite; a cursor on (created_at, id) pages cleanly\"}]}"
J4="$AMEND"  # built first: bash 3.2 mangles \" nested in "$( )"
R4=$(call $A "$SA" ask-plan "$J4")
expect "alice revises the same ticket" "$R4" "plan ticket updated"
expect "…and the ticket itself moved, not only the why: the goal is the revised one" "$(rows $A "$SA" "$PID")" "goal: .{0,3}stream the export, paged by cursor"
wait_until "bob is told the plan moved" "revised the why" bash -c "cat '$OUT/bob.log'"
J5="{\"ticketId\":\"$PID\",\"findings\":\"cursor paging — yes\"}"  # built first: bash 3.2 mangles \" nested in "$( )"
R5=$(call $B "$SB" post-review "$J5")
expect "bob agrees now" "$R5" "your take is on"

echo "## answered is the signal, closed is the decision, when-closed comes at the close"
wait_until "alice's address step is hers now" "ticket .{1,10} step address actionable" bash -c "cat '$OUT/alice.log'"
SETTLED=$(call $A "$SA" settle-step "{\"ticketId\":\"$PID\",\"stepId\":\"address\",\"result\":\"cursor paging it is\"}")
expect "the settle offers the close and nothing else" "$SETTLED" "When your user says they are done with it .{1,6} and only then .{1,6} call close-ticket"
expect "…the when-closed line is NOT handed over on a settle" "$(echo "$SETTLED" | grep -c 'WHEN CLOSED')" "^0$"
CLOSED=$(call $A "$SA" close-ticket "{\"ticketId\":\"$PID\",\"reason\":\"agreed: stream rows paged by cursor\"}")
expect "alice closes with the conclusion as the reason" "$CLOSED" "closed .{1,3}stream the export, paged by cursor.{1,60} .{1,3} agreed: stream rows paged by cursor"
expect "…and only now is her instruction handed back to her agent — one instruction: report the close, then act" "$CLOSED" "TELL YOUR USER that the ticket is closed, THEN carry out what it says to do when closed .{1,6} .{1,3}open a Jira ticket for the export work"
expect "…not two: no bare 'ticket closed' line beside it" "$(echo "$CLOSED" | grep -c 'ONLY THIS')" "^0$"

echo "## the work follows the plan, and says so"
TASK=$(call $A "$SA" create-ticket "{\"goal\":\"bulk export, streamed\",\"project\":\"sandbox\",\"from\":[\"$PID\"],\"steps\":[{\"owner\":\"bob\",\"intent\":\"implement\",\"description\":\"cursor-paged export\"}]}")
TID=$(echo "$TASK" | grep -oE 'id: [0-9a-f-]{36}' | head -1 | cut -d' ' -f2)
expect "the task names the plan it follows" "$(rows $A "$SA" "$TID")" "from: $PID"

echo "## a proposal: work alice wants bob to do — his ✓ is what starts it"
NOPEER='{"project":"sandbox","goal":"x","decisions":[{"what":"a","userWhy":"b"}],"forks":[],"work":[{"intent":"do","description":"it"}]}'
J6="$NOPEER"  # built first: bash 3.2 mangles \" nested in "$( )"
R6=$(call $A "$SA" propose "$J6")
expect "a proposal with nobody asked is refused: it is work for someone" "$R6" "failed: a proposal is work your user wants someone else to do"
NOWORK='{"peers":["bob"],"project":"sandbox","goal":"x","decisions":[{"what":"a","userWhy":"b"}],"forks":[]}'
J7="$NOWORK"  # built first: bash 3.2 mangles \" nested in "$( )"
R7=$(call $A "$SA" propose "$J7")
expect "…and without the work spelled out" "$R7" "failed: a proposal needs .work."
PROP="{\"peers\":[\"bob\"],\"project\":\"sandbox\",\"goal\":\"expose the export in the backoffice UI\",\"summary\":\"a button on the customer page\",\"decisions\":[{\"what\":\"a download button on the customer page\",\"userWhy\":\"support keeps asking for the file by mail\"}],\"forks\":[],\"from\":[\"$PID\"],\"work\":[{\"intent\":\"build\",\"description\":\"the button and the download\"}]}"
PROPOSED=$(call $A "$SA" propose "$PROP")
expect "filed as a proposal to bob" "$PROPOSED" "proposal ticket filed, asked of bob"
QID=$(echo "$PROPOSED" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
wait_until "bob sees it" "kind: proposal" rows $B "$SB" "$QID"
QROWS=$(rows $B "$SB" "$QID")
expect "bob has a take step and a work step waiting on it" "$QROWS" "work-build-bob,bob,build,(pending|suspended),review-bob"
expect "…the work is not his to do yet" "$(grep -c 'step work-build-bob actionable' "$OUT/bob.log")" "^0$"
expect "…and the proposal follows the plan" "$QROWS" "from: $PID"
echo "## bob wants the work changed — alice revises the work on the same ticket"
NO="{\"ticketId\":\"$QID\",\"findings\":\"a button is fine but it needs a job, not a request-time export\",\"failed\":true}"
call $B "$SB" post-review "$NO" > /dev/null
wait_until "alice hears the change request" "ticket ${QID:0:8}: bob asked for changes" bash -c "cat '$OUT/alice.log'"
DUP="{\"ticketId\":\"$QID\",\"work\":[{\"intent\":\"build\",\"description\":\"a\"},{\"intent\":\"build\",\"description\":\"b\"}]}"
expect "two work items that would share an id are refused, not collapsed" "$(call $A "$SA" propose "$DUP")" "two work items would share the id .{1,3}build"
# the request-time build is withdrawn; a job-enqueuing button and a mail step replace it,
# two items with the same intent kept apart by their own ids
REWORK="{\"ticketId\":\"$QID\",\"decisions\":[{\"what\":\"the button enqueues a job; the file comes by mail\",\"userWhy\":\"bob is right that the export is too slow for a request\"}],\"retireWork\":[\"build\"],\"work\":[{\"id\":\"enqueue\",\"intent\":\"build\",\"description\":\"the button, enqueuing an export job\"},{\"id\":\"mail\",\"intent\":\"build\",\"description\":\"the mailer that sends the finished file\"}],\"whenClosed\":\"\"}"
REVISED=$(call $A "$SA" propose "$REWORK")
expect "the proposal is revised, not re-filed" "$REVISED" "proposal ticket updated"
QROWS2=$(rows $A "$SA" "$QID")
expect "the withdrawn work is retired: on the ticket, never up" "$QROWS2" "work-build-bob,bob,build,retired"
expect "the new work stands on its own id, same intent notwithstanding" "$QROWS2" "work-enqueue-bob,bob,build,(pending|suspended),review-bob,.{0,3}the button, enqueuing an export job"
expect "…and so does the second" "$QROWS2" "work-mail-bob,bob,build,(pending|suspended),review-bob"
expect "…his ↻ take is history, untouched" "$QROWS2" "review-bob,bob,take,failed"
expect "an empty whenClosed withdrew the instruction" "$(echo "$QROWS2" | grep -c 'whenClosed')" "^0$"
COLLIDE="{\"ticketId\":\"$QID\",\"work\":[{\"id\":\"review\",\"intent\":\"review\",\"description\":\"review the mailer output\"}]}"
call $A "$SA" propose "$COLLIDE" > /dev/null
QROWS3=$(rows $A "$SA" "$QID")
expect "a work item called review lands in the work namespace, not on bob's take" "$QROWS3" "work-review-bob,bob,review,(pending|suspended),review-bob"
expect "…and his take step is exactly as it was" "$QROWS3" "review-bob,bob,take,failed"
NONE="{\"ticketId\":\"$QID\",\"retireWork\":[\"build\"]}"
expect "retiring what is already retired is refused, saying so" "$(call $A "$SA" propose "$NONE")" "none of build is pending work"
wait_until "bob's copy has the revised work" "work-enqueue-bob" rows $B "$SB" "$QID"
YES="{\"ticketId\":\"$QID\",\"findings\":\"yes, next sprint\"}"
call $B "$SB" post-review "$YES" > /dev/null
wait_until "bob's ✓ started the work: the enqueue step is his now" "step work-enqueue-bob actionable" bash -c "cat '$OUT/bob.log'"
wait_until "…and the mailer too" "step work-mail-bob actionable" bash -c "cat '$OUT/bob.log'"
expect "…but not the retired one" "$(grep -c 'step work-build-bob actionable' "$OUT/bob.log")" "^0$"
kill_all; summary
