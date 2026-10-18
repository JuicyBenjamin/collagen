#!/bin/bash
# Epics: a folder of tickets that together make one body of work, shaped by
# anyone in the room. alice files a languages proposal and one per language;
# three are not enough to be offered an epic; she makes one with all three in it.
# bob — not its author — adds a proposal from another project, takes one
# out, and moves it to an epic of his own. A plan grown out of a part lives
# in the epic without being added. Closing with parts left needs a reason,
# reopening always does, and anyone may do either; close-ticket points at
# the epic tool. No CLI runs. KEEP=1 leaves alice and bob up, to look at
# the room in a TUI.
source "$(dirname "$0")/lib.sh"
kill_all; fresh_logs; prep_profiles; testnet
# bob with no ai: a mock would act on what lands for him
python3 -c 'import json,sys; json.dump({"preferredAi":None,"rooms":{"st-test3":[{"id":"b-sandbox","name":"sandbox","path":sys.argv[2]},{"id":"b-solo","name":"backoffice","path":sys.argv[2]}]}}, open(sys.argv[1]+"/state-bob-"+sys.argv[3]+".json","w"))' "$CFG" "$OUT/sandbox" "$SCN"
start alice; start bob
SA=$(mcp $A); wait_for_peer $A "$SA" bob; SB=$(mcp $B); admitted bob
uuid() { grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1; }

echo "## three related proposals, filed together: the third offers an epic"
P1='{"title":"the review page reads more languages","project":"sandbox","goal":"the review page reads more languages","decisions":[{"title":"More than TypeScript","what":"PHP, then Rust","userWhy":"half our stack is PHP"}]}'
L=$(call $A "$SA" propose "$P1" | uuid)
P2="{\"title\":\"PHP on the review page\",\"project\":\"sandbox\",\"goal\":\"PHP on the review page\",\"from\":[\"$L\"],\"decisions\":[{\"title\":\"Intelephense\",\"what\":\"a pinned server\",\"agentWhy\":\"fast\"}]}"
OUT2=$(call $A "$SA" propose "$P2"); PHP=$(echo "$OUT2" | uuid)
expect "the second is not offered an epic yet" "$(echo "$OUT2" | grep -c RELATED)" "^0$"
P3="{\"title\":\"Rust on the review page\",\"project\":\"sandbox\",\"goal\":\"Rust on the review page\",\"from\":[\"$L\"],\"decisions\":[{\"title\":\"rust-analyzer\",\"what\":\"a pinned server\",\"agentWhy\":\"official\"}]}"
OUT3=$(call $A "$SA" propose "$P3"); RUST=$(echo "$OUT3" | uuid)
expect "the third is not either: three of one lineage are not enough to ask" "$(echo "$OUT3" | grep -c RELATED)" "^0$"

echo "## alice makes the epic, with the three in it"
NOTITLE='{"action":"create","goal":"more languages"}'
expect "an epic needs a title" "$(call $A "$SA" epic "$NOTITLE")" "failed: pass a 'title' .{1,3} the epic's headline"
E1J="{\"title\":\"More languages\",\"action\":\"create\",\"goal\":\"More languages\",\"summary\":\"Review PHP and Rust like TypeScript.\",\"ticketIds\":[\"$L\",\"$PHP\",\"$RUST\"]}"
MADE=$(call $A "$SA" epic "$E1J"); E1=$(echo "$MADE" | uuid)
expect "filed, and the three put in it: one piece of work, grown out of each other" "$MADE" "epic filed: .{1,3}More languages.*put into the epic .{1,3}More languages.{1,3}: .*It now holds 3 ticket\\(s\\) in 1 piece\\(s\\) of work, 0 of 1 done"
wait_until "bob sees the epic and what is in it" "parts: .?0 of 1 pieces of work done" everything $B "$SB"
expect "…each part names its epic" "$(everything $B "$SB" | grep -cE "epic: .?$E1")" "^[3-9]"

echo "## anyone shapes it: bob adds one from another project, takes one out"
B1='{"title":"a PHP lint in the backoffice","project":"backoffice","goal":"a PHP lint in the backoffice","decisions":[{"title":"Lint it","what":"phpstan","agentWhy":"cheap"}]}'
BO=$(call $B "$SB" propose "$B1" | uuid)
ADD="{\"action\":\"add\",\"epicId\":\"$E1\",\"ticketIds\":[\"$BO\"]}"
expect "bob — not its author — adds a backoffice ticket to alice's epic: a second piece of work" "$(call $B "$SB" epic "$ADD")" "put into the epic .{1,3}More languages.*It now holds 4 ticket\\(s\\) in 2 piece\\(s\\) of work"
wait_until "alice sees two pieces of work, across two projects" "parts: .?0 of 2 pieces of work done" everything $A "$SA"
OUTJ="{\"action\":\"remove\",\"ticketIds\":[\"$PHP\"]}"
expect "bob takes the PHP proposal out" "$(call $B "$SB" epic "$OUTJ")" "taken out of their epic: .{1,3}PHP on the review page"
wait_until "…and alice sees three tickets in it" "parts: .?0 of 2 pieces of work done" everything $A "$SA"
E2J='{"title":"Backoffice quality","action":"create","goal":"Backoffice quality","summary":"Catch PHP mistakes before review."}'
E2=$(call $B "$SB" epic "$E2J" | uuid)
MOVE="{\"action\":\"add\",\"epicId\":\"$E2\",\"ticketIds\":[\"$BO\"]}"
expect "bob moves his ticket from alice's epic to his own" "$(call $B "$SB" epic "$MOVE")" "put into the epic .{1,3}Backoffice quality"
wait_until "it is in one epic only: his" "epic: .?$E2" everything $A "$SA"
Q1="{\"action\":\"add\",\"epicId\":\"$E1\",\"ticketIds\":[\"$E2\"]}"
expect "an epic is never part of another" "$(call $A "$SA" epic "$Q1")" "an epic is never part of another"

echo "## what grows out of a part goes into its epic as it is filed"
PL="{\"title\":\"how Rust gets its server\",\"project\":\"sandbox\",\"goal\":\"how Rust gets its server\",\"summary\":\"download a pinned rust-analyzer\",\"from\":[\"$RUST\"],\"decisions\":[{\"title\":\"Pinned binary\",\"what\":\"a release and its hash\",\"agentWhy\":\"no npm\"}],\"forks\":[]}"
PLOUT=$(call $A "$SA" ask-plan "$PL"); PLAN=$(echo "$PLOUT" | uuid)
expect "filing it puts it in the Rust proposal's epic, and says so" "$PLOUT" "It went into the epic .{1,3}More languages.*epic remove takes it out"
expect "…its user is told where it went" "$PLOUT" "plan ticket has been filed, in the epic .{1,3}More languages"
expect "…and nobody is asked about it" "$(echo "$PLOUT" | grep -c 'EPIC:')" "^0$"
expect "…it is in the epic now" "$(everything $A "$SA" | grep -cE "epic: .?$E1")" "^3$"
wait_until "…a stage of the same piece of work: still one" "parts: .?0 of 1 pieces of work done" everything $A "$SA"
KEPT="{\"title\":\"Rust in CI\",\"project\":\"sandbox\",\"goal\":\"Rust in CI\",\"summary\":\"a CI job\",\"from\":[\"$RUST\"],\"epic\":null,\"decisions\":[{\"title\":\"A job\",\"what\":\"cargo check\",\"agentWhy\":\"cheap\"}],\"forks\":[]}"
KOUT=$(call $A "$SA" ask-plan "$KEPT")
expect "filed with epic: null, it stays out" "$KOUT" "plan ticket has been filed.{1,3} They asked"
expect "…and is not offered the epic either" "$(echo "$KOUT" | grep -c 'EPIC:')" "^0$"
expect "…the epic still holds three" "$(everything $A "$SA" | grep -cE "epic: .?$E1")" "^3$"

echo "## progress counts pieces of work, order is for reading"
TASK='{"title":"a Go grammar spike","project":"sandbox","goal":"a Go grammar spike","steps":[{"id":"s1","owner":"alice","intent":"spike","description":"try it"}]}'
TID=$(call $A "$SA" create-ticket "$TASK" | uuid)
ADDT="{\"action\":\"add\",\"epicId\":\"$E1\",\"ticketIds\":[\"$TID\"]}"
expect "the task goes in too: a second piece of work" "$(call $A "$SA" epic "$ADDT")" "It now holds 4 ticket\\(s\\) in 2 piece\\(s\\) of work, 0 of 2 done"
SETTLE="{\"ticketId\":\"$TID\",\"stepId\":\"s1\",\"result\":\"works\"}"
call $A "$SA" settle-step "$SETTLE" > /dev/null
wait_until "a done piece counts: 1 of 2" "parts: .?1 of 2 pieces of work done" everything $A "$SA"
CLOSE0="{\"action\":\"close\",\"epicId\":\"$E1\"}"
expect "closing waits on what is unresolved, and names it" "$(call $B "$SB" epic "$CLOSE0")" "still holds 3 unresolved ticket\\(s\\).*Rust on the review page.*exclude them from its progress"
EXC="{\"action\":\"exclude\",\"epicId\":\"$E1\",\"ticketIds\":[\"$L\",\"$RUST\"]}"
expect "dropped work is excluded from progress, not counted done" "$(call $B "$SB" epic "$EXC")" "kept in .{1,3}More languages.{1,3} but out of its progress.*1 of 2 done"
ORD="{\"action\":\"order\",\"epicId\":\"$E1\",\"ticketIds\":[\"$RUST\",\"$TID\",\"$L\"]}"
expect "anyone orders it — for reading, it sets no after" "$(call $B "$SB" epic "$ORD")" "now read in this order: .{1,3}Rust on the review page.*sets no after"
expect "…get-ticket lists its parts in that order" "$(everything $A "$SA" | grep -oE "1 of 2 pieces of work done: [0-9a-f -]+" | head -1)" "^1 of 2 pieces of work done: $RUST $TID $L $PLAN"

echo "## closing and reopening: anyone, with a reason"
CLP="{\"ticketId\":\"$PLAN\",\"outcome\":\"done\",\"reason\":\"merged\"}"
expect "alice closes the plan as done, its step never settled" "$(call $A "$SA" close-ticket "$CLP")" "how Rust gets its server.{1,3} .ticket [0-9a-f-]{36}. as done .{1,3} merged"
wait_until "its piece of work is done with it: 2 of 2" "parts: .?2 of 2 pieces of work done" everything $A "$SA"
expect "with everything resolved it closes, on that alone" "$(call $B "$SB" epic "$CLOSE0")" "closed the epic .{1,3}More languages.*its parts are done"
wait_until "alice sees it closed, and why" "closedBecause: its parts are done" everything $A "$SA"
GO='{"title":"a Go server","project":"sandbox","goal":"a Go server","steps":[{"id":"s1","owner":"alice","intent":"build","description":"gopls"}]}'
GOID=$(call $A "$SA" create-ticket "$GO" | uuid)
Q2="{\"action\":\"add\",\"epicId\":\"$E1\",\"ticketIds\":[\"$GOID\"]}"
expect "a closed epic takes nothing in: reopen it first" "$(call $A "$SA" epic "$Q2")" "is closed .{1,3} reopen it first"
REOPEN0="{\"action\":\"reopen\",\"epicId\":\"$E1\"}"
expect "reopening always needs a reason" "$(call $A "$SA" epic "$REOPEN0")" "reopening .{1,3}More languages.{1,3} needs a reason"
REOPEN1="{\"action\":\"reopen\",\"epicId\":\"$E1\",\"reason\":\"more languages in the same area: Go next\"}"
expect "alice reopens it" "$(call $A "$SA" epic "$REOPEN1")" "reopened the epic .{1,3}More languages.*Go next"
wait_until "bob sees it open again, and why" "openBecause: .?more languages in the same area: Go next" everything $B "$SB"
expect "…and the Go work can go in now" "$(call $A "$SA" epic "$Q2")" "put into the epic .{1,3}More languages"
Q4="{\"ticketId\":\"$E1\"}"
CTX=$(call $A "$SA" review-context "$Q4")
expect "review-context on the epic: its aim" "$CTX" "aim: Review PHP and Rust like TypeScript"
expect "…its count, and what keeps it open" "$CTX" "progress: 2 of 3 pieces of work done"
expect "…each ticket's state, the excluded ones said" "$CTX" "Rust on the review page,excluded"
Q5="{\"ticketId\":\"$E1\",\"outcome\":\"done\"}"
expect "close-ticket on an epic points at the epic tool" "$(call $A "$SA" close-ticket "$Q5")" "is an epic .{1,3} it closes \\(and reopens\\) with the epic tool"

echo "## a close says how it ended, and the epic counts it"
CLG="{\"ticketId\":\"$GOID\",\"outcome\":\"done\",\"reason\":\"merged\"}"
expect "alice closes the Go work as done, its step never settled" "$(call $A "$SA" close-ticket "$CLG")" "a Go server.{1,3} .ticket [0-9a-f-]{36}. as done .{1,3} merged"
wait_until "the epic counts it done: 3 of 3" "parts: .?3 of 3 pieces of work done" everything $A "$SA"
TASK2='{"title":"a Kotlin grammar spike","project":"sandbox","goal":"a Kotlin grammar spike","steps":[{"id":"s1","owner":"alice","intent":"spike","description":"try it"}]}'
TID2=$(call $A "$SA" create-ticket "$TASK2" | uuid)
ADDOUT=$(call $A "$SA" epic "{\"action\":\"add\",\"epicId\":\"$E1\",\"ticketIds\":[\"$TID2\"]}")
expect "another goes in" "$ADDOUT" "3 of 4 done"
CLOUT=$(call $A "$SA" close-ticket "{\"ticketId\":\"$TID2\",\"outcome\":\"dropped\",\"reason\":\"not now\"}")
expect "closing it as dropped" "$CLOUT" "as dropped \\(out of its epic's progress\\)"
wait_until "…takes it out of the count: 3 of 3" "parts: .?3 of 3 pieces of work done" everything $A "$SA"
expect "review-context says how each ended" "$(call $A "$SA" review-context "$Q4")" "a Kotlin grammar spike,dropped"
expect "…a close without an outcome is refused at the tool" "$(call $A "$SA" close-ticket "{\"ticketId\":\"$TID2\"}")" "outcome"

echo "## renaming: its author's, as a ticket's title is"
RN="{\"action\":\"rename\",\"epicId\":\"$E1\",\"title\":\"Support more review languages\",\"goal\":\"the review page reads code beyond TypeScript\"}"
expect "bob — not its author — is pointed at alice" "$(call $B "$SB" epic "$RN")" "is its author's to rename"
expect "alice renames it" "$(call $A "$SA" epic "$RN")" "epic .{1,3}Support more review languages.{1,3} .*updated"
wait_until "bob sees the new title" "Support more review languages" everything $B "$SB"
expect "…and its parts kept" "$(everything $B "$SB" | grep -cE "epic: .?$E1")" "^[3-9]"
expect "…and the epic tool names it by its new title" "$(call $B "$SB" epic "$ORD")" "Support more review languages.{1,3} is now read in this order"

if [ "${KEEP:-0}" = "1" ]; then summary; exit; fi
kill_all; summary
