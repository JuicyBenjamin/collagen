#!/bin/bash
# A review asked for without a ticket: bob asks alice for a review of her
# branch, which has no review ticket. Her collagen finds the conversation she
# did the work in (a Claude Code session log on her machine), a filing job —
# a stand-in `claude` (fake-claude.mjs) — reads a copy of it and files the
# review ticket in her name with the why from it, and bob's review starts on
# it: his step arrives, or the review he already wrote goes on as his take.
# Every stage comes back to bob on their thread. Covers her steering not
# chosen (nothing runs until she chooses), just do it (filed on its own),
# her being offline when asked, and ask first (her agent asks; she declines).
source "$(dirname "$0")/lib.sh"
kill_all; fresh_logs; prep_profiles; testnet
UUID='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

echo "## alice's project is a clone with her branch, and her Claude Code session on it"
REPO="$OUT/sandbox"
(
  cd "$REPO" && git init -q -b main && git config user.email alice@example.com && git config user.name alice
  echo 'export const thing = (n) => n;' > thing.js && git add thing.js && git commit -qm "thing"
  git clone -q --bare "$REPO" "$OUT/origin.git" && git remote add origin "$OUT/origin.git" && git fetch -q origin
  git checkout -qb feat/review-me && echo 'export const thing = (n) => n * 2;' > thing.js && git commit -qam "thing counts twice"
)
NOW=$(python3 -c 'import datetime; print(datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"))')
SESSION=5e55a0aa-0000-4000-8000-00000000a11c
PROJECTS="$SHOME/.claude/projects"
mkdir -p "$PROJECTS/-alice-sandbox" "$PROJECTS/-elsewhere"
LOG="$PROJECTS/-alice-sandbox/$SESSION.jsonl"
python3 - "$LOG" "$REPO" "$SESSION" "$NOW" <<'PY'
import json, sys
log, repo, session, now = sys.argv[1:]
entry = lambda kind, content: {"type": kind, "message": {"role": kind, "content": content}, "cwd": repo, "gitBranch": "feat/review-me", "sessionId": session, "timestamp": now}
with open(log, "w") as out:
    out.write(json.dumps(entry("user", "Make thing count twice: the dashboard shows half since the batch change.")) + "\n")
    out.write(json.dumps(entry("assistant", [{"type": "text", "text": "Doubling inside thing(), so every caller gets it. Edited thing.js."}])) + "\n")
PY
# a session elsewhere, on another branch: never taken for her work
python3 -c 'import json,sys; open(sys.argv[1],"w").write(json.dumps({"type":"user","message":{"role":"user","content":"unrelated"},"cwd":"/somewhere/else","gitBranch":"main","sessionId":"0ther","timestamp":sys.argv[2]})+"\n")' "$PROJECTS/-elsewhere/0ther0000-0000-4000-8000-000000000000.jsonl" "$NOW"
BEFORE=$(shasum "$LOG")

echo "## a stand-in claude on PATH plays the filing job; bob runs no AI, so what reaches him waits in his inbox"
mkdir -p "$OUT/bin"
printf '#!/bin/sh\nexec node "%s/fake-claude.mjs" "$@"\n' "$E2E" > "$OUT/bin/claude"; chmod +x "$OUT/bin/claude"
export PATH="$OUT/bin:$PATH" FAKE_CLAUDE_CALLS="$OUT/claude.calls"
python3 -c 'import json,sys; p=sys.argv[1]; s=json.load(open(p)); s["preferredAi"]=None; json.dump(s, open(p,"w"))' "$CFG/state-bob-$SCN.json"
start alice; start bob
SA=$(mcp $A); wait_for_peer $A "$SA" bob; SB=$(mcp $B); admitted bob
expect "alice's filing job runs with Claude Code" "$(call $A "$SA" set-jobs '{"job":"filing","harness":"claude-code"}')" "filing a review asked of you: with Claude Code, model sonnet"

# the thread between them, and what is on it for each
pair() { call "$1" "$2" pending-threads '{}' | grep -oE '[0-9a-f]{16}' | head -1; }
said() { local t; t=$(pair "$1" "$2"); [ -n "$t" ] && call "$1" "$2" get-messages "{\"threadId\":\"$t\"}" | python3 -c 'import sys; print(sys.stdin.read().replace("\\n", "\n"))'; }
# bob's inbox, read once and kept: each read drains it
BOBSAW="$OUT/bob.saw"; : > "$BOBSAW"
bob_saw() { said $B "$SB" >> "$BOBSAW"; cat "$BOBSAW"; }
# how many tickets bob has heard were filed for him
filed_count() { bob_saw > /dev/null; grep -oE "filed the review ticket: Thing counts twice \[$UUID" "$BOBSAW" | sort -u | wc -l | tr -d ' '; }

echo "## not chosen: bob asks; nothing runs until alice chooses"
expect "send-to-peer is not the way: request-review needs the work named" "$(call $B "$SB" request-review '{"peer":"alice"}')" "failed: name the work"
ASKED=$(call $B "$SB" request-review '{"peer":"alice","branch":"feat/review-me","note":"you said it is ready"}')
expect "bob's ask goes to alice, and his agent says one line" "$ASKED" "asked alice for a review ticket on branch feat/review-me.*TELL YOUR USER ONLY THIS"
wait_until "alice's agent is told her steering is not chosen, and nothing was filed" "steering for review asks is not chosen, so nothing was filed" said $A "$SA"
REQ=$(call $A "$SA" review-request '{}' | grep -oE "$UUID" | head -1)
expect "the ask waits on her, listed by review-request" "$REQ" "$UUID"
YES="{\"requestId\":\"$REQ\",\"file\":true}"
expect "her yes alone does not run her AI while nothing is chosen" "$(call $A "$SA" review-request "$YES")" "failed: steering for filing a review .* is not chosen"
wait_until "bob hears it waits on alice" "review-request:waiting.*Waits on alice" bob_saw
expect "nothing ran" "$(cat "$OUT/claude.calls" 2>/dev/null | grep -c -- '"-p"')" "^0$"

echo "## alice chooses just do it for others' asks, and says yes to this one"
expect "set-steering takes the new kind" "$(call $A "$SA" set-steering '{"kind":"review","whose":"others","level":"auto"}')" "review: filing a review of your work someone asks for"
FILING=$(call $A "$SA" review-request "$YES")
expect "her yes starts the filing job" "$FILING" "Claude Code \(sonnet\) (is reading|will read)"
wait_until "the job filed it, and bob hears so with the ticket" "filed the review ticket: Thing counts twice \[$UUID\]" bob_saw
TICKET=$(grep -oE "filed the review ticket: Thing counts twice \[$UUID" "$BOBSAW" | grep -oE "$UUID" | head -1)
expect "…after hearing it was being filed" "$(cat "$BOBSAW")" "review-request:filing.*reading the conversation the work was done in"
CALL=$(grep -- '"-p"' "$OUT/claude.calls" | head -1)
expect "the job ran Sonnet" "$CALL" '"--model","sonnet"'
expect "…may read the copy collagen made, and nothing of hers else" "$CALL" "\"--add-dir\",\"[^\"]*review-asks-alice-$SCN/$REQ\""
expect "…may call only what filing needs" "$CALL" "ask-review,mcp__[^\"]*review-request"
expect "…was told the conversation it reads" "$CALL" "conversation-1.md"
COPY=$(ls "$CFG/review-asks-alice-$SCN/$REQ"/conversation-1.md)
expect "the copy is her conversation, the session on her branch" "$(cat "$COPY")" "dashboard shows half since the batch change"
expect "…not the session elsewhere" "$(grep -c unrelated "$COPY")" "^0$"
expect "…with the change beside it" "$(cat "$CFG/review-asks-alice-$SCN/$REQ/change.diff")" "n \* 2"
expect "her session log was read, never touched" "$(shasum "$LOG")" "^${BEFORE%% *}"
wait_until "bob has the ticket" "kind: review" rows $B "$SB" "$TICKET"
T=$(rows $B "$SB" "$TICKET"); echo "$T" > "$OUT/first-ticket.txt"
expect "it is alice's, filed in her name" "$T" "createdBy: alice"
expect "…on her branch" "$T" "feat/review-me"
expect "…naming the conversation it was read from" "$T" "claude-code $SESSION"
expect "bob is the one asked: his review step" "$T" "review-bob,bob,review,(pending|suspended)"
WHY="{\"ticketId\":\"$TICKET\"}"
expect "her why is her own words, from that conversation" "$(call $B "$SB" review-context "$WHY")" "dashboard shows half since the batch change"
wait_until "bob's review starts: his step reaches him on their thread" "ticket-step:review" bob_saw
expect "…his agent is told to start it" "$(cat "$BOBSAW")" "start the review as their work steering allows"

echo "## a review bob already wrote goes on the ticket as his take"
WRITTEN=$(call $B "$SB" request-review '{"peer":"alice","branch":"feat/review-me","review":{"findings":"Looks right. Name the factor.","failed":false}}')
expect "the ask says his review goes on once filed" "$WRITTEN" "your user's review goes on it as their take"
wait_until "filed on its own, at just do it" "^2$" filed_count
SECOND=$(grep -oE "filed the review ticket: Thing counts twice \[$UUID" "$BOBSAW" | grep -oE "$UUID" | grep -v "$TICKET" | head -1)
wait_until "bob's written review is his take on it" "Looks right. Name the factor." rows $B "$SB" "$SECOND"
expect "…on a step of his own, nobody asked" "$(rows $B "$SB" "$SECOND")" "bob,.*review,settled"

echo "## alice is offline when bob asks; it is filed once she is back"
stop alice
expect "offline, her projects are not known: bob names it" "$(call $B "$SB" request-review '{"peer":"alice","branch":"feat/review-me"}')" "not online.*pass 'project'"
OFF=$(call $B "$SB" request-review '{"peer":"alice","project":"sandbox","branch":"feat/review-me"}')
expect "the ask goes on the log, for her to read when back" "$OFF" "offline"
start alice; SA=$(mcp $A); wait_for_peer $A "$SA" bob
wait_until "filed after she came back" "^3$" filed_count

echo "## ask first: her agent asks her; she declines, and bob is told why"
call $A "$SA" set-steering '{"kind":"review","whose":"others","level":"ask"}' > /dev/null
call $B "$SB" request-review '{"peer":"alice","branch":"feat/review-me","note":"once more"}' > /dev/null
wait_until "alice's agent is to ask her" "ASK YOUR USER, in one line, whether to file the review ticket" said $A "$SA"
REQ2=$(call $A "$SA" review-request '{}' | grep -oE "$UUID" | tail -1)
wait_until "bob hears she is asked" "review-request:asking.*alice is asked whether to file it" bob_saw
NO="{\"requestId\":\"$REQ2\",\"decline\":\"not ready yet\"}"
expect "her no" "$(call $A "$SA" review-request "$NO")" "^declined; bob is told"
wait_until "bob hears she declined, and why" "alice declined: not ready yet" bob_saw

[ "${KEEP:-0}" = 1 ] && { echo "alice: $A ($SA), bob: $B ($SB)"; summary; exit; }
kill_all; summary
