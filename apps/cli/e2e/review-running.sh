#!/bin/bash
# A review's change, running: alice's review names the pages it changed, and
# the review page lists them. A credential in a page's url is refused: the
# ticket reaches every peer. No CLI runs.
# KEEP=1 leaves alice up and prints the page's url.
source "$(dirname "$0")/lib.sh"
kill_all; fresh_logs; prep_profiles; testnet
[ -f "$ROOT/../review-web/dist/index.html" ] || (cd "$ROOT/../review-web" && npx vite build > /dev/null 2>&1)

R="$OUT/sandbox"
git -C "$R" init -q -b main
git -C "$R" config user.email e2e@collagen.test; git -C "$R" config user.name e2e
printf 'a\n' > "$R/api.ts"; git -C "$R" add -A; git -C "$R" commit -qm base
git -C "$R" checkout -qb feat/export
printf 'b\n' > "$R/api.ts"; git -C "$R" add -A; git -C "$R" commit -qm change

start alice
SA=$(mcp $A)
D1='{"title":"Export streams","what":"rows are streamed","userWhy":"the export times out","where":["api.ts"]}'
ask() { call $A "$SA" ask-review "$1"; }

echo "## a credential on the ticket is refused"
expect "a password in the url" "$(ask "{\"title\":\"Export\",\"project\":\"sandbox\",\"base\":\"main\",\"summary\":\"big exports finish\",\"decisions\":[$D1],\"forks\":[],\"shows\":[{\"title\":\"Export\",\"url\":\"https://me:hunter2@staging.example.com/export\"}]}")" "^failed: .*sign-in"
expect "a token in its query" "$(ask "{\"title\":\"Export\",\"project\":\"sandbox\",\"base\":\"main\",\"summary\":\"big exports finish\",\"decisions\":[$D1],\"forks\":[],\"shows\":[{\"title\":\"Export\",\"url\":\"https://staging.example.com/export?access_token=abc\"}]}")" "^failed: .*access_token"

SHOWS="[{\"title\":\"Export page\",\"url\":\"http://localhost:5173/export\"},{\"title\":\"On staging\",\"url\":\"https://staging.example.com/export\"}]"
TICKET=$(ask "{\"title\":\"Export\",\"project\":\"sandbox\",\"base\":\"main\",\"summary\":\"big exports finish\",\"decisions\":[$D1],\"forks\":[],\"shows\":$SHOWS}" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
expect "the review is filed with where it runs" "$TICKET" "^[0-9a-f-]{36}$"
expect "its agent reads them back" "$(call $A "$SA" review-context "{\"ticketId\":\"$TICKET\"}")" "https://staging.example.com/export"

ORIGIN=${A%/mcp}
SERVER_ENTRY="$ROOT/../review-web/dist/server/entry.js"
sfn_id() { grep -oE "registerServerReference\(\"$1-[0-9a-f]+\"" "$SERVER_ENTRY" | head -1 | sed -E 's/.*"(.*)"/\1/'; }
sfn() { node "$E2E/sfn.mjs" "$ORIGIN/review/_server/data/$(sfn_id "$1")?args=$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$2")"; }

echo "## the page lists them"
wait_until "the review's data is served" '"shows"' sfn reviewData "[\"$TICKET\"]"
DATA=$(sfn reviewData "[\"$TICKET\"]")
expect "the page, marked as running on its author's machine" "$DATA" '"id":"s1","title":"Export page","url":"http://localhost:5173/export","local":true'
expect "the staging page, not local" "$DATA" '"id":"s2","title":"On staging","url":"https://staging.example.com/export","local":false'

if [ "${KEEP:-0}" = "1" ]; then echo "KEEP: $ORIGIN/review/$TICKET"; summary; exit; fi
kill_all; summary
