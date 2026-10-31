#!/bin/bash
# A question about a review that its why does not answer: bob reads alice's
# review and asks her AI (ask-author). Her collagen finds the conversation she
# did the work in (a Claude Code session log on her machine), an answering
# job — a stand-in `claude` (fake-claude.mjs) — reads a copy of it and answers
# with review-question; the answer reaches bob and goes onto the review's why,
# marked as read from her AI. Covers her steering not chosen (nothing runs),
# just do it (answered on its own), and a question that finds a flaw: with
# her work steering at just do it, it is handed to the conversation that
# built the work, and bob hears it is being fixed.
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
mkdir -p "$PROJECTS/-alice-sandbox"
python3 - "$PROJECTS/-alice-sandbox/$SESSION.jsonl" "$REPO" "$SESSION" "$NOW" <<'PY'
import json, sys
log, repo, session, now = sys.argv[1:]
entry = lambda kind, content: {"type": kind, "message": {"role": kind, "content": content}, "cwd": repo, "gitBranch": "feat/review-me", "sessionId": session, "timestamp": now}
with open(log, "w") as out:
    out.write(json.dumps(entry("user", "Double inside thing(), not in the dashboard: the export reads thing() too.")) + "\n")
    out.write(json.dumps(entry("assistant", [{"type": "text", "text": "Doubling inside thing(), so every caller gets it. Edited thing.js."}])) + "\n")
PY

echo "## a stand-in claude on PATH plays the answering job; bob runs no AI"
mkdir -p "$OUT/bin"
printf '#!/bin/sh\nexec node "%s/fake-claude.mjs" "$@"\n' "$E2E" > "$OUT/bin/claude"; chmod +x "$OUT/bin/claude"
export PATH="$OUT/bin:$PATH" FAKE_CLAUDE_CALLS="$OUT/claude.calls"
python3 -c 'import json,sys; p=sys.argv[1]; s=json.load(open(p)); s["preferredAi"]=None; json.dump(s, open(p,"w"))' "$CFG/state-bob-$SCN.json"
start alice; start bob
SA=$(mcp $A); wait_for_peer $A "$SA" bob; SB=$(mcp $B); admitted bob
expect "alice's answering job runs with Claude Code" "$(call $A "$SA" set-jobs '{"job":"answering","harness":"claude-code"}')" "answering a question about your review: with Claude Code, model sonnet"
D1='{"title":"Counts right again","what":"thing() doubles its count","userWhy":"the dashboard shows half","where":["thing.js:1"]}'
TICKET=$(call $A "$SA" ask-review "{\"title\":\"Thing counts twice\",\"project\":\"sandbox\",\"branch\":\"feat/review-me\",\"base\":\"main\",\"summary\":\"the dashboard is right again\",\"decisions\":[$D1]}" | grep -oE "$UUID" | head -1)
wait_until "bob has her review" "Thing counts twice" call $B "$SB" get-tickets '{}'

# the thread between them, and what is on it for bob, read once and kept: each read drains it
pair() { call "$1" "$2" pending-threads '{}' | grep -oE '[0-9a-f]{16}' | head -1; }
said() { local t; t=$(pair "$1" "$2"); [ -n "$t" ] && call "$1" "$2" get-messages "{\"threadId\":\"$t\"}" | python3 -c 'import sys; print(sys.stdin.read().replace("\\n", "\n"))'; }
BOBSAW="$OUT/bob.saw"; : > "$BOBSAW"
bob_saw() { said $B "$SB" >> "$BOBSAW"; cat "$BOBSAW"; }
why() { call $A "$SA" review-context "{\"ticketId\":\"$TICKET\"}"; }

echo "## not chosen: bob asks; nothing runs until alice chooses"
expect "her own review is not hers to ask about" "$(call $A "$SA" ask-author "{\"ticketId\":\"$TICKET\",\"question\":\"why?\"}")" "failed: it is your user's own review"
ASKED=$(call $B "$SB" ask-author "{\"ticketId\":\"$TICKET\",\"question\":\"Why double inside thing() and not in the dashboard?\",\"lines\":{\"file\":\"thing.js\",\"from\":{\"line\":1,\"side\":\"RIGHT\"},\"to\":{\"line\":1,\"side\":\"RIGHT\"},\"text\":\"+export const thing = (n) => n * 2;\"}}")
expect "bob asked her AI" "$ASKED" "asked alice's AI"
wait_until "bob hears it waits on her" "Waits on alice" bob_saw
QID=$(call $A "$SA" review-question '{}' | grep -oE "$UUID" | head -1)
expect "alice's collagen keeps it, waiting" "$(call $A "$SA" review-question '{}')" "Why double inside thing\(\).*waiting"
expect "…and no job ran" "$(cat "$OUT/claude.calls" 2>/dev/null | grep -c -- '-p')" "^0$"

echo "## just do it: her AI answers from the conversation the work was done in"
call $A "$SA" set-steering '{"kind":"answer","whose":"others","level":"auto"}' > /dev/null
YES=$(call $A "$SA" review-question "{\"questionId\":\"$QID\",\"answer\":true}")
echo "  (yes: ${YES:0:300})"
expect "her yes runs it now" "$YES" "is reading|will read"
wait_until "bob gets the answer, from the conversation" "alice's AI answered.*|Double inside thing\(\), not in the dashboard" bob_saw
wait_until "the review's why has it, marked as read from her AI" "read from alice's AI" why
expect "…saying what the conversation said" "$(why)" "the export reads thing\(\) too"
expect "…and her conversation was only read, never written" "$(tail -1 "$PROJECTS/-alice-sandbox/$SESSION.jsonl")" "Edited thing.js"

echo "## a question that finds a flaw: with her work steering at just do it, the conversation that built it fixes it"
call $A "$SA" set-steering '{"kind":"work","whose":"others","level":"auto"}' > /dev/null
call $B "$SB" ask-author "{\"ticketId\":\"$TICKET\",\"question\":\"What about a negative count?\"}" > /dev/null
wait_until "bob hears it is being fixed, and what" "fixing it in the conversation the work was done in.*negative" bob_saw
expect "…her thread with bob now wakes the conversation that built the work" "$(python3 -c 'import json,sys; s=json.load(open(sys.argv[1])); print(json.dumps(s.get("threads",{})))' "$CFG/state-alice-$SCN.json")" "$SESSION"

kill_all
summary
