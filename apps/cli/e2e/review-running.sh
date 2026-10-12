#!/bin/bash
# A review's change, running: alice's review names the page it changed and
# the request it changed. The page lists both; the request is sent again
# from the reader's own instance — the body edited, signed in with a token
# kept on that machine alone: never on the ticket, never back to the page,
# never to another origin. A credential on the ticket is refused. The API is
# a stand-in on a free local port that echoes what reached it. No CLI runs.
# KEEP=1 leaves alice and the API up and prints the page's url.
source "$(dirname "$0")/lib.sh"
kill_all; fresh_logs; prep_profiles; testnet
[ -f "$ROOT/../review-web/dist/index.html" ] || (cd "$ROOT/../review-web" && npx vite build > /dev/null 2>&1)

echo "## an API that echoes what reached it, on a free port"
# (outside 41000–48999: a collagen's own ports, which a show is never sent to)
API_PORT=$(python3 -c '
import socket
while True:
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close()
    if not 41000 <= p < 49000: print(p); break')
python3 - "$API_PORT" > "$OUT/api.log" 2>&1 <<'PY' &
import json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
class H(BaseHTTPRequestHandler):
    def answer(self):
        if self.path == "/moved":
            self.send_response(302); self.send_header("Location", "https://elsewhere.example/steal"); self.end_headers(); return
        n = int(self.headers.get("content-length") or 0)
        out = json.dumps({"method": self.command, "path": self.path, "auth": self.headers.get("authorization"), "type": self.headers.get("content-type"), "body": self.rfile.read(n).decode()}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(out))); self.end_headers(); self.wfile.write(out)
    do_GET = do_POST = answer
    def log_message(self, *a): pass
HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
PY
API_PID=$!
disown
API="http://127.0.0.1:$API_PORT"

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
expect "a token in a header" "$(ask "{\"title\":\"Export\",\"project\":\"sandbox\",\"base\":\"main\",\"summary\":\"big exports finish\",\"decisions\":[$D1],\"forks\":[],\"shows\":[{\"title\":\"Export\",\"url\":\"$API/export\",\"method\":\"GET\",\"headers\":[{\"name\":\"Authorization\",\"value\":\"Bearer abc\"}]}]}")" "^failed: .*credential"
expect "a password in the body" "$(ask "{\"title\":\"Export\",\"project\":\"sandbox\",\"base\":\"main\",\"summary\":\"big exports finish\",\"decisions\":[$D1],\"forks\":[],\"shows\":[{\"title\":\"Log in\",\"url\":\"$API/login\",\"method\":\"POST\",\"body\":\"{\\\"password\\\":\\\"hunter2\\\"}\"}]}")" "^failed: .*password"

SHOWS="[{\"title\":\"Export page\",\"url\":\"http://localhost:5173/export\"},{\"title\":\"Export call\",\"url\":\"$API/export\",\"method\":\"post\",\"body\":\"{\\\"rows\\\":10}\",\"signIn\":\"$API/login\"},{\"title\":\"Moved\",\"url\":\"$API/moved\",\"method\":\"GET\"},{\"title\":\"Own tools\",\"url\":\"$A\",\"method\":\"POST\",\"body\":\"{}\"}]"
TICKET=$(ask "{\"title\":\"Export\",\"project\":\"sandbox\",\"base\":\"main\",\"summary\":\"big exports finish\",\"decisions\":[$D1],\"forks\":[],\"shows\":$SHOWS}" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
expect "the review is filed with where it runs" "$TICKET" "^[0-9a-f-]{36}$"
expect "its agent reads them back" "$(call $A "$SA" review-context "{\"ticketId\":\"$TICKET\"}")" "POST $API/export"

ORIGIN=${A%/mcp}
SERVER_ENTRY="$ROOT/../review-web/dist/server/entry.js"
sfn_id() { grep -oE "registerServerReference\(\"$1-[0-9a-f]+\"" "$SERVER_ENTRY" | head -1 | sed -E 's/.*"(.*)"/\1/'; }
sfn() { node "$E2E/sfn.mjs" "$ORIGIN/review/_server/data/$(sfn_id "$1")?args=$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$2")"; }
post() { node "$E2E/sfn.mjs" post "$ORIGIN/review/_server/$(sfn_id "$1")" "$2" ${3:+"$3"}; }

echo "## the page lists them"
wait_until "the review's data is served" '"shows"' sfn reviewData "[\"$TICKET\"]"
DATA=$(sfn reviewData "[\"$TICKET\"]")
expect "the page, marked as running on its author's machine" "$DATA" '"id":"s1","title":"Export page","url":"http://localhost:5173/export","local":true'
expect "the request, its method in capitals, not signed in" "$DATA" "\"id\":\"s2\",\"title\":\"Export call\",\"url\":\"$API/export\",\"method\":\"POST\".*\"signedIn\":false"

echo "## sent from the reader's instance"
SENT=$(post sendShow "[\"$TICKET\",\"s2\",\"{\\\"rows\\\":500}\"]")
expect "the edited body reaches the API, as JSON" "$SENT" '"status":200.*\\"body\\": ?\\"{\\\\\\"rows\\\\\\":500}\\"'
expect "…with no sign-in" "$SENT" '\\"auth\\": ?null'

echo "## signed in on this machine only"
expect "the token is kept" "$(post signInShow "[\"$TICKET\",\"s2\",\"tok-123\"]")" '"ok":true'
expect "…in this profile's own state" "$(cat "$CFG/state-$(profile alice).json")" "\"signIns\":\{\"$API\":\"tok-123\"\}"
DATA=$(sfn reviewData "[\"$TICKET\"]")
expect "the page is told it is signed in" "$DATA" '"signedIn":true'
expect_not() { if echo "$2" | grep -qE "$3"; then echo "  FAIL $1"; FAIL=$((FAIL + 1)); else echo "  ok   $1"; PASS=$((PASS + 1)); fi; }
expect_not "…and never given the token" "$DATA" "tok-123"
expect "the request goes out with it" "$(post sendShow "[\"$TICKET\",\"s2\",null]")" '\\"auth\\": ?\\"Bearer tok-123\\"'
expect "a redirect is reported, never followed" "$(post sendShow "[\"$TICKET\",\"s3\",null]")" '"status":302.*"location":"https://elsewhere.example/steal"'
expect "a collagen on this machine is never sent to" "$(post sendShow "[\"$TICKET\",\"s4\",null]")" '"error":"that address is a collagen on this machine'
expect "a page is not sent" "$(post sendShow "[\"$TICKET\",\"s1\",null]")" '"error":"that is a page to open, not a request"'
expect "a send from another site is refused" "$(post sendShow "[\"$TICKET\",\"s2\",null]" http://evil.example)" "^HTTP 403$"
expect "the token is in no other file of this instance's" "$(grep -rlaF tok-123 "$CFG" | grep -v "/state-$(profile alice).json$" | wc -l | tr -d ' ')" "^0$"
expect "signing out forgets it" "$(post signInShow "[\"$TICKET\",\"s2\",null]")" '"ok":true'
expect_not "…gone from the state" "$(cat "$CFG/state-$(profile alice).json")" "tok-123"

if [ "${KEEP:-0}" = "1" ]; then echo "KEEP: $ORIGIN/review/$TICKET (api pid $API_PID)"; summary; exit; fi
kill "$API_PID" 2>/dev/null
kill_all; summary
