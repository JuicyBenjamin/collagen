#!/bin/bash
# Epics: a folder of tickets that together make one body of work, shaped by
# anyone in the room. alice files a languages proposal and one per language;
# the third filing offers her an epic. She makes one with all three in it.
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
P1='{"project":"sandbox","goal":"the review page reads more languages","decisions":[{"title":"More than TypeScript","what":"PHP, then Rust","userWhy":"half our stack is PHP"}]}'
L=$(call $A "$SA" propose "$P1" | uuid)
P2="{\"project\":\"sandbox\",\"goal\":\"PHP on the review page\",\"from\":[\"$L\"],\"decisions\":[{\"title\":\"Intelephense\",\"what\":\"a pinned server\",\"agentWhy\":\"fast\"}]}"
OUT2=$(call $A "$SA" propose "$P2"); PHP=$(echo "$OUT2" | uuid)
expect "the second is not offered an epic yet" "$(echo "$OUT2" | grep -c RELATED)" "^0$"
P3="{\"project\":\"sandbox\",\"goal\":\"Rust on the review page\",\"from\":[\"$L\"],\"decisions\":[{\"title\":\"rust-analyzer\",\"what\":\"a pinned server\",\"agentWhy\":\"official\"}]}"
OUT3=$(call $A "$SA" propose "$P3"); RUST=$(echo "$OUT3" | uuid)
expect "the third is: offer an epic for all three, only on her yes" "$OUT3" "RELATED: your user has filed 3 related tickets together.*only on their yes"

echo "## alice makes the epic, with the three in it"
NOGOAL='{"action":"create"}'
expect "an epic needs a goal" "$(call $A "$SA" epic "$NOGOAL")" "failed: pass the epic's goal"
E1J="{\"action\":\"create\",\"goal\":\"More languages\",\"summary\":\"Review PHP and Rust like TypeScript.\",\"ticketIds\":[\"$L\",\"$PHP\",\"$RUST\"]}"
MADE=$(call $A "$SA" epic "$E1J"); E1=$(echo "$MADE" | uuid)
expect "filed, and the three put in it" "$MADE" "epic filed: .{1,3}More languages.*put into the epic .{1,3}More languages.{1,3}: .*It now holds 3 part\\(s\\), 0 done"
wait_until "bob sees the epic and what is in it" "parts: .?0 of 3 done" call $B "$SB" get-tickets '{}'
expect "…each part names its epic" "$(call $B "$SB" get-tickets '{}' | grep -cE "epic: .?$E1")" "^[3-9]"

echo "## anyone shapes it: bob adds one from another project, takes one out"
B1='{"project":"backoffice","goal":"a PHP lint in the backoffice","decisions":[{"title":"Lint it","what":"phpstan","agentWhy":"cheap"}]}'
BO=$(call $B "$SB" propose "$B1" | uuid)
ADD="{\"action\":\"add\",\"epicId\":\"$E1\",\"ticketIds\":[\"$BO\"]}"
expect "bob — not its author — adds a backoffice ticket to alice's epic" "$(call $B "$SB" epic "$ADD")" "put into the epic .{1,3}More languages.*It now holds 4 part\\(s\\)"
wait_until "alice sees four parts, across two projects" "parts: .?0 of 4 done" call $A "$SA" get-tickets '{}'
OUTJ="{\"action\":\"remove\",\"ticketIds\":[\"$PHP\"]}"
expect "bob takes the PHP proposal out" "$(call $B "$SB" epic "$OUTJ")" "taken out of their epic: .{1,3}PHP on the review page"
wait_until "…and alice sees three again" "parts: .?0 of 3 done" call $A "$SA" get-tickets '{}'
E2J='{"action":"create","goal":"Backoffice quality","summary":"Catch PHP mistakes before review."}'
E2=$(call $B "$SB" epic "$E2J" | uuid)
MOVE="{\"action\":\"add\",\"epicId\":\"$E2\",\"ticketIds\":[\"$BO\"]}"
expect "bob moves his ticket from alice's epic to his own" "$(call $B "$SB" epic "$MOVE")" "put into the epic .{1,3}Backoffice quality"
wait_until "it is in one epic only: his" "epic: .?$E2" call $A "$SA" get-tickets '{}'
expect "an epic is never part of another" "$(call $A "$SA" epic "{\"action\":\"add\",\"epicId\":\"$E1\",\"ticketIds\":[\"$E2\"]}")" "an epic is never part of another"

echo "## what grows out of a part lives in the epic, unmoved"
PL="{\"project\":\"sandbox\",\"goal\":\"how Rust gets its server\",\"summary\":\"download a pinned rust-analyzer\",\"from\":[\"$RUST\"],\"decisions\":[{\"title\":\"Pinned binary\",\"what\":\"a release and its hash\",\"agentWhy\":\"no npm\"}],\"forks\":[]}"
PLAN=$(call $A "$SA" ask-plan "$PL" | uuid)
expect "the plan from the Rust proposal is in the epic, through it" "$(call $A "$SA" get-tickets '{}' | grep -E "epic: .?$E1" | grep -c "through the ticket it grew out of")" "^1$"
CTX=$(call $A "$SA" review-context "{\"ticketId\":\"$E1\"}")
expect "review-context on the epic: its aim" "$CTX" "aim: Review PHP and Rust like TypeScript"
expect "…how far along its parts are" "$CTX" "progress: 0 of 2 parts done"
expect "…the plan listed as there through the ticket it grew out of" "$CTX" "how Rust gets its server.*through the ticket it grew out of"

echo "## closing and reopening: anyone, with a reason"
CLOSE0="{\"action\":\"close\",\"epicId\":\"$E1\"}"
expect "closing with parts left needs a reason" "$(call $B "$SB" epic "$CLOSE0")" "still has 2 of 2 part\\(s\\) not done .{1,3} closing it needs a reason"
CLOSE1="{\"action\":\"close\",\"epicId\":\"$E1\",\"reason\":\"superseded by a plan per language\"}"
expect "bob closes alice's epic, with his reason" "$(call $B "$SB" epic "$CLOSE1")" "closed the epic .{1,3}More languages.*superseded by a plan per language"
wait_until "alice sees it closed, and why" "closedBecause: superseded by a plan per language" call $A "$SA" get-tickets '{}'
expect "a closed epic takes nothing in: reopen it first" "$(call $A "$SA" epic "{\"action\":\"add\",\"epicId\":\"$E1\",\"ticketIds\":[\"$PHP\"]}")" "is closed .{1,3} reopen it first"
REOPEN0="{\"action\":\"reopen\",\"epicId\":\"$E1\"}"
expect "reopening always needs a reason" "$(call $A "$SA" epic "$REOPEN0")" "reopening .{1,3}More languages.{1,3} needs a reason"
REOPEN1="{\"action\":\"reopen\",\"epicId\":\"$E1\",\"reason\":\"more languages in the same area: Go next\"}"
expect "alice reopens it" "$(call $A "$SA" epic "$REOPEN1")" "reopened the epic .{1,3}More languages.*Go next"
wait_until "bob sees it open again, and why" "reopenedBecause: .?more languages in the same area: Go next" call $B "$SB" get-tickets '{}'
expect "close-ticket on an epic points at the epic tool" "$(call $A "$SA" close-ticket "{\"ticketId\":\"$E1\"}")" "is an epic .{1,3} it closes \\(and reopens\\) with the epic tool"

if [ "${KEEP:-0}" = "1" ]; then summary; exit; fi
kill_all; summary
