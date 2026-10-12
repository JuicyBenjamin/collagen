#!/bin/bash
# Asking your own AI about code on the review page: alice selects lines of a
# review and asks; her collagen runs the AI she set (the mock — no model, a
# few words back in Claude's stream format) in her clone, and the answer
# streams into the page's live chat as it is written. The commit the page
# shows goes with the question, and one her clone lacks is refused; a second
# question goes on with the same conversation; New chat starts over; with no
# AI set the page says so and nothing runs. KEEP=1 leaves alice up.
source "$(dirname "$0")/lib.sh"
kill_all; fresh_logs; prep_profiles; testnet
[ -f "$ROOT/../review-web/dist/server/entry.js" ] || (cd "$ROOT/../review-web" && pnpm build > /dev/null 2>&1)

R="$OUT/sandbox"
git -C "$R" init -q -b main
git -C "$R" config user.email e2e@collagen.test; git -C "$R" config user.name e2e
mkdir -p "$R/src"
printf 'export const a = 1;\n' > "$R/src/export.ts"
git -C "$R" add -A; git -C "$R" commit -qm base
git -C "$R" checkout -qb feat/stream-export
printf 'export const a = 1;\nexport const stream = (rows) => rows.map(String);\n' > "$R/src/export.ts"
git -C "$R" add -A; git -C "$R" commit -qm change

start alice
SA=$(mcp $A)
call $A "$SA" set-ai '{"ai":"mock:claude-code"}' > /dev/null
D1='{"title":"Stream the rows","what":"stream the rows","userWhy":"the export times out","where":["src/export.ts:2"]}'
TICKET=$(call $A "$SA" ask-review "{\"title\":\"Stream the export\",\"project\":\"sandbox\",\"base\":\"main\",\"summary\":\"stream it\",\"decisions\":[$D1]}" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
ORIGIN=${A%/mcp}
SERVER_ENTRY="$ROOT/../review-web/dist/server/entry.js"
sfn_id() { grep -oE "registerServerReference\(\"$1-[0-9a-f]+\"" "$SERVER_ENTRY" | head -1 | sed -E 's/.*"(.*)"/\1/'; }
sfn_url() { echo "$ORIGIN/review/_server/${3:-data}/$(sfn_id "$1")?args=$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$2")"; }
sfn() { node "$E2E/sfn.mjs" "$(sfn_url "$1" "$2")"; }
# the chat as the page gets it: over its WebSocket (ReviewServer's
# /review/_live), each value on a line, for $3 seconds (2)
sfn_live() {
  node -e '
    const [origin, name, args, seconds] = process.argv.slice(1);
    const topic = { chatLive: "chat" }[name];
    const socket = new WebSocket(`${origin.replace(/^http/, "ws")}/review/_live`, { headers: { Origin: origin } });
    socket.onopen = () => socket.send(JSON.stringify({ open: "e2e", topic, subject: JSON.parse(args)[0] }));
    socket.onmessage = (event) => { const message = JSON.parse(String(event.data)); if (!message.end) console.log(JSON.stringify(message.value)); };
    setTimeout(() => process.exit(0), Number(seconds) * 1000);
  ' "$ORIGIN" "$1" "$2" "${3:-2}"
}
post() { node "$E2E/sfn.mjs" post "$ORIGIN/review/_server/$(sfn_id "$1")" "$2" ${3:+"$3"}; }

wait_until "the review's data is served" '"commit"' sfn reviewData "[\"$TICKET\"]"
SHOWN=$(sfn reviewData "[\"$TICKET\"]" | python3 -c 'import json,sys; print(json.load(sys.stdin)["commit"])')
SEL='{"file":"src/export.ts","from":{"line":2,"side":"RIGHT"},"to":{"line":2,"side":"RIGHT"},"text":"+export const stream = (rows) => rows.map(String);"}'

echo "## the conversation, live: empty, the AI named"
# the stream is Solid's encoding: keys apart from their values, in order
expect "the page sees her AI and no turns yet" "$(sfn_live chatLive "[\"$TICKET\"]")" '"ai":"mock:claude-code".*"turns":\[\]'


echo "## a question about selected lines, answered as it is written"
expect "a commit her clone lacks is refused" "$(post askAi "[\"$TICKET\",\"why map?\",$SEL,\"deadbeef\"]")" '"error":"deadbee is not in your clone"'
expect "an empty question is a bad request" "$(post askAi "[\"$TICKET\",\"  \",null,null]")" '"error":"bad request"'
expect "a selection outside the tree is a bad request" "$(post askAi "[\"$TICKET\",\"hm\",{\"file\":\"../x\",\"from\":{\"line\":1,\"side\":\"RIGHT\"},\"to\":{\"line\":1,\"side\":\"RIGHT\"},\"text\":\"\"},null]")" '"error":"bad request"'
expect "a write from another site is refused" "$(post askAi "[\"$TICKET\",\"why map?\",null,null]" http://evil.example)" "^HTTP 403$"
expect "asked at the commit the page shows: under way" "$(post askAi "[\"$TICKET\",\"why map over rows?\",$SEL,\"$SHOWN\"]")" '"ok":true'
wait_until "the answer streams into the chat, the selection beside its question" '"why map over rows\?".*"src/export.ts".*"Mock answer: why map over rows\?".*"done"' sfn_live chatLive "[\"$TICKET\"]"
expect "a follow-up goes on with the conversation" "$(post askAi "[\"$TICKET\",\"and strings?\",null,\"$SHOWN\"]")" '"ok":true'
wait_until "…both turns there, the second answered" '"why map over rows\?".*"and strings\?".*"Mock answer: and strings\?".*"done"' sfn_live chatLive "[\"$TICKET\"]"

echo "## Stop ends an answer where it is, and its process with it"
LONG="slow $(printf 'word %.0s' $(seq 1 120))"
expect "a long answer is under way" "$(post askAi "[\"$TICKET\",\"$LONG\",null,\"$SHOWN\"]")" '"ok":true'
wait_until "…streaming" '"Mock answer: slow word' sfn_live chatLive "[\"$TICKET\"]"
post stopAnswer "[\"$TICKET\"]" > /dev/null
wait_until "…stopped, what it said kept" '"Mock answer: slow word.*"stopped"' sfn_live chatLive "[\"$TICKET\"]"
expect "…and the AI's process is gone" "$(pgrep -f 'content_block_delta' | wc -l | tr -d ' ')" "^0$"
expect "a question after it is answered" "$(post askAi "[\"$TICKET\",\"still there?\",null,\"$SHOWN\"]")" '"ok":true'
wait_until "…in the same conversation" '"Mock answer: still there\?".*"done"' sfn_live chatLive "[\"$TICKET\"]"

echo "## New chat starts over; no AI, nothing runs"
post newChat "[\"$TICKET\"]" > /dev/null
said() { sfn_live chatLive "[\"$TICKET\"]" | grep -c "$1"; }
wait_until "the turns are gone" "^0$" said "why map over rows"
call $A "$SA" set-ai '{"ai":"none"}' > /dev/null
wait_until "with no AI set the page says so" "No AI set in collagen" sfn_live chatLive "[\"$TICKET\"]"
expect "…and asking is refused" "$(post askAi "[\"$TICKET\",\"anyone?\",null,null]")" '"error":"No AI set in collagen"'

if [ "${KEEP:-0}" = "1" ]; then call $A "$SA" set-ai '{"ai":"mock:claude-code"}' > /dev/null; echo "KEEP: $ORIGIN/review/$TICKET"; summary; exit; fi
kill_all
summary
