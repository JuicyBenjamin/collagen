#!/bin/bash
# The board in the browser: the room's tickets in to do, in progress and
# done at /board/<short room id>, by the rule the terminal's board uses
# (p2p boardColumn). alice files a ticket bob is working on, one waiting on
# it (to do: nothing of it is handed to anyone), and one she drops (done).
# The page is served on loopback for a room alice is in; its data puts each
# ticket in its column, for her eyes only where the ticket is hers alone; a
# ticket moving moves the board's token. KEEP=1 leaves alice up and prints
# the url. No CLI runs.
source "$(dirname "$0")/lib.sh"
kill_all; fresh_logs; prep_profiles; testnet
[ -f "$ROOT/../review-web/dist/index.html" ] || (cd "$ROOT/../review-web" && npx vite build > /dev/null 2>&1)
start alice; start bob
SA=$(mcp $A); SB=$(mcp $B); wait_for_peer $A "$SA" bob; admitted bob
ORIGIN=${A%/mcp}
SHORT=$(python3 -c 'import hashlib; print(hashlib.sha256(b"collagen-short:st-test3").hexdigest()[:8])')
SERVER_ENTRY="$ROOT/../review-web/dist/server/entry.js"
sfn_id() { grep -oE "registerServerReference\(\"$1-[0-9a-f]+\"" "$SERVER_ENTRY" | head -1 | sed -E 's/.*"(.*)"/\1/'; }
sfn_url() { echo "${4:-$ORIGIN}/review/_server/${3:-data}/$(sfn_id "$1")?args=$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$2")"; }
sfn() { node "$E2E/sfn.mjs" "$(sfn_url "$1" "$2" data "${3:-$ORIGIN}")"; }
sfn_live() { curl -s -N -m "${3:-4}" "$(sfn_url "$1" "$2" live)"; }
id_of() { grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1; }
# the column a ticket is in on someone's board, or "none"
column_of() { sfn boardData "[\"$SHORT\"]" "${2:-$ORIGIN}" | python3 -c 'import json,sys
b = json.load(sys.stdin) or {"lanes": []}
print(next((l["column"] for l in b["lanes"] for c in l["cards"] if c["id"] == sys.argv[1]), "none"))' "$1"; }
dropped_of() { sfn boardData "[\"$SHORT\"]" | python3 -c 'import json,sys
print(next((c["dropped"] for l in json.load(sys.stdin)["lanes"] for c in l["cards"] if c["id"] == sys.argv[1]), None))' "$1"; }

echo "## the page: served on loopback for a room alice is in"
expect "/board/<short id> is the page" "$(curl -s "$ORIGIN/board/$SHORT")" "<div id=\"root\">"
expect "another Host is refused" "$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: evil.test' "$ORIGIN/board/$SHORT")" "403"
expect "a full room id is not a board's name" "$(curl -s -o /dev/null -w '%{http_code}' "$ORIGIN/board/st-test3")" "404"
expect "a room alice is not in has no board" "$(sfn boardData '["0badc0de"]')" "null"

echo "## three tickets, three columns"
WORK=$(call $A "$SA" create-ticket '{"title":"count the rows","project":"sandbox","goal":"count the rows","steps":[{"id":"s1","owner":"bob","intent":"count","description":"count them"},{"id":"s2","owner":"alice","intent":"check","description":"check the count","needs":["s1"]}]}' | id_of)
NEXT=$(call $A "$SA" create-ticket "{\"title\":\"sum the rows\",\"project\":\"sandbox\",\"goal\":\"sum the rows\",\"after\":[\"$WORK\"],\"steps\":[{\"id\":\"s1\",\"owner\":\"bob\",\"intent\":\"sum\",\"description\":\"sum them\"}]}" | id_of)
GONE=$(call $A "$SA" create-ticket '{"title":"a spike nobody needs","project":"sandbox","goal":"a spike nobody needs","steps":[{"id":"s1","owner":"alice","intent":"spike","description":"try it"}]}' | id_of)
call $A "$SA" close-ticket "{\"ticketId\":\"$GONE\",\"outcome\":\"dropped\",\"reason\":\"not needed\"}" > /dev/null
TOKEN0=$(sfn_live boardChanges "[\"$SHORT\"]" 3 | grep -oE '[0-9a-f]{40}' | head -1)
wait_until "bob's step is handed to him: in progress" "^doing$" column_of "$WORK"
expect "the one waiting on it is to do" "$(column_of "$NEXT")" "^todo$"
expect "…and on alice's board alone: bob is not shown it" "$(column_of "$NEXT" "${B%/mcp}")" "^none$"
expect "the dropped one is done" "$(column_of "$GONE")" "^done$"
expect "…and says it was dropped" "$(dropped_of "$GONE")" "True"

echo "## the board moves when a ticket does"
call $B "$SB" settle-step "{\"ticketId\":\"$WORK\",\"stepId\":\"s1\",\"result\":\"42 rows\"}" > /dev/null
call $A "$SA" settle-step "{\"ticketId\":\"$WORK\",\"stepId\":\"s2\",\"result\":\"checked\"}" > /dev/null
wait_until "every step answered: done" "^done$" column_of "$WORK"
TOKEN1=$(sfn_live boardChanges "[\"$SHORT\"]" 3 | grep -oE '[0-9a-f]{40}' | head -1)
expect "the board's token moved" "$([ -n "$TOKEN1" ] && [ "$TOKEN0" != "$TOKEN1" ] && echo moved)" "moved"
expect "what waited on it is shown to bob now" "$(column_of "$NEXT" "${B%/mcp}")" "^(todo|doing|done)$"

if [ "${KEEP:-}" = "1" ]; then echo "board: $ORIGIN/board/$SHORT (alice and bob left running)"; else kill_all; fi
summary
