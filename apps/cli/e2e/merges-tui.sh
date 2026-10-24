#!/bin/bash
# The merges tab: what was merged into alice's project's default branch, the
# latest first, named by its pull request — her review of pull request #6
# drawn under it, #5 (from no ticket) with nothing under it. The host is a
# stand-in (fake-gh.mjs). In the pty: `3` opens the tab on her first project,
# enter drops onto the row of project tabs, ↓ into the list, `p` hands #6's pull request to the browser opener (a stand-in on
# PATH), ↓ reaches its review, under what it grew from, enter opens its page, esc comes back
# to the merges with the cursor where it was, `o` there opens the ticket's
# review page, and `o` on a merge the project's merges as a web page
# (review-web, /merges/<roomId>/<project>), whose data is read here as the
# page reads it; the room's address goes on to it (/merges/<roomId>).
source "$(dirname "$0")/lib.sh"
kill_all; fresh_logs; prep_profiles; testnet
# the web page is a Solid app served from its build; build it if this checkout has not
[ -f "$ROOT/../review-web/dist/server/entry.js" ] || (cd "$ROOT/../review-web" && pnpm build > /dev/null 2>&1)
mkdir -p "$OUT/sandbox/.git/refs/remotes/origin"
printf 'ref: refs/heads/feat/paging\n' > "$OUT/sandbox/.git/HEAD"
printf '[remote "origin"]\n\turl = git@github.com:acme/sandbox.git\n' > "$OUT/sandbox/.git/config"
printf 'ref: refs/remotes/origin/main\n' > "$OUT/sandbox/.git/refs/remotes/origin/HEAD"
GH="$OUT/gh"; mkdir -p "$GH"
start bob
PTY="$OUT/merges-tui.out"; MARKS="$OUT/merges-tui.marks"; LOG="$OUT/merges-tui.log"
rm -f "$PTY" "$MARKS" "$OUT/merges-tui.go" "$OUT/merges-tui.done" "$LOG" "$LOG.keys" "$OUT/opened"
mkdir -p "$OUT/bin"; for b in open xdg-open; do printf '#!/bin/sh\necho "$@" >> "%s/opened"\n' "$OUT" > "$OUT/bin/$b"; chmod +x "$OUT/bin/$b"; done
mark() { echo "$1 $(wc -c < "$PTY")" >> "$MARKS"; }
( while [ ! -f "$OUT/merges-tui.go" ]; do sleep 1; done; wait_pty "$PTY" "tickets"; sleep 1
  printf '3'; sleep 3; mark M0_tab
  printf '\r'; sleep 1; printf '\033[B'; sleep 1; mark M1_list
  printf 'p'; sleep 2
  for _ in 1 2 3; do printf '\033[B'; sleep 0.5; done; sleep 1; mark M2_ticket_row
  printf '\r'; sleep 2; mark M3_ticket
  printf '\033'; sleep 2; mark M4_back; sleep 1
  printf 'o'; sleep 2
  for _ in 1 2 3; do printf '\033[A'; sleep 0.5; done; sleep 1; printf 'o'; sleep 2; mark M5_web
  printf '\033[F'; sleep 3; printf '\033[F'; sleep 3; printf '\033[F'; sleep 3; mark M6_end
  for i in $(seq 1 30); do [ -f "$OUT/merges-tui.done" ] && break; sleep 1; done; printf 'q' ) | \
  PATH="$OUT/bin:$PATH" COLLAGEN_GH="$E2E/fake-gh.mjs" FAKE_GH_DIR="$GH" HOME="$SHOME" COLLAGEN_DEV=1 COLLAGEN_LOG="$LOG" script -F -q "$PTY" bash -c "stty rows ${ROWS:-30} cols ${COLS:-100}; $TUI" > /dev/null 2>&1 &
SA=$(mcp $A); wait_for_peer $A "$SA" bob; admitted bob

echo "## alice's review is pull request #6"
D1='{"title":"Rows a page","what":"the list reads a page of rows at a time","userWhy":"long lists were slow","where":["src/page.ts:1"]}'
uuid() { grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1; }
# what the review grew from: her proposal, then her plan for it
IDEA=$(call $A "$SA" propose '{"title":"Long lists in pages","project":"sandbox","goal":"long lists in pages","decisions":[{"title":"Pages","what":"a page of rows at a time","userWhy":"the list hangs"}]}' | uuid)
PLAN=$(call $A "$SA" ask-plan "{\"title\":\"Page the rows\",\"project\":\"sandbox\",\"goal\":\"page the rows\",\"summary\":\"fifty rows a page\",\"from\":[\"$IDEA\"],\"decisions\":[{\"title\":\"Fifty a page\",\"what\":\"fifty rows\",\"agentWhy\":\"one screen\"}],\"forks\":[]}" | uuid)
ASK="{\"title\":\"Paging the rows\",\"peers\":[],\"project\":\"sandbox\",\"base\":\"main\",\"branch\":\"feat/paging\",\"link\":\"https://github.com/acme/sandbox/pull/6\",\"summary\":\"rows come a page at a time\",\"from\":[\"$PLAN\"],\"decisions\":[$D1]}"
ASKED=$(call $A "$SA" ask-review "$ASK")
expect "the review ticket is on the log" "$ASKED" "review ticket filed"
touch "$OUT/merges-tui.go"
await_mark() { local i; for i in $(seq 1 40); do grep -q "$1" "$MARKS" 2>/dev/null && return 0; sleep 1; done; echo "  FAIL TUI never reached $1 (see $PTY)"; FAIL=$((FAIL+1)); return 1; }
await_mark M6_end; sleep 1
KEYS=$(cut -d' ' -f2 "$LOG.keys" 2>/dev/null | tr '\n' ' ')
TEXT=$(perl -pe 's/\e\[[0-9;?]*[a-zA-Z]//g' "$PTY")

echo "## the merges, the latest first, each with the tickets it came from"
expect "the host was asked what was merged into main" "$(grep -c '"base=main"' "$GH/calls.log")" "^[1-9]"
expect "the cursor reached the list" "$KEYS" "merges"
expect "enter on the ticket's line opened its page" "$KEYS" "ticket-steps"
expect "p handed the pull request to the browser" "$(head -1 "$OUT/opened" 2>/dev/null)" "^https://github.com/acme/sandbox/pull/6$"
expect "o on the ticket's line handed its review page to the browser" "$(cat "$OUT/opened" 2>/dev/null)" "/review/"
echo "## the project's merges as a web page"
WEB=$(grep -oE 'http://[^ ]+/merges/[^ ]+' "$OUT/opened" 2>/dev/null | head -1)
expect "o on a merge handed the project's merges page to the browser, at that merge" "$WEB" "^${A%/mcp}/merges/[0-9A-Za-z-]+/sandbox#6$"
PAGE=${WEB%%#*}; ROOM=$(echo "$PAGE" | sed -E 's#.*/merges/([^/]+)/.*#\1#')
expect "the page is served" "$(curl -s -o /dev/null -w '%{http_code} %{content_type}' "$PAGE")" "^200 text/html"
expect "…and the room's, which goes on to a project's" "$(curl -s -o /dev/null -w '%{http_code} %{content_type}' "${PAGE%/*}")" "^200 text/html"
SERVER_ENTRY="$ROOT/../review-web/dist/server/entry.js"
sfn() { node "$E2E/sfn.mjs" "${A%/mcp}/review/_server/data/$(grep -oE "registerServerReference\\(\"$1-[0-9a-f]+\"" "$SERVER_ENTRY" | head -1 | sed -E 's/.*"(.*)"/\1/')?args=$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$2")"; }
expect "the room's projects here, for its tabs and where its address goes" "$(sfn mergeProjects "[\"$ROOM\"]" | python3 -c 'import json,sys; print(*json.load(sys.stdin)["projects"])')" "^sandbox$"
HISTORY=$(sfn mergeHistory "[\"$ROOM\",\"sandbox\",50,false]")
expect "its data: into main, the latest first" "$(echo "$HISTORY" | python3 -c 'import json,sys; d=json.load(sys.stdin)["history"]; print(d["base"], *[m["number"] for m in d["merges"]])')" "^main 6 5 1000 "
expect "…#6 linked to its pull request, her ticket under it as hers" "$(echo "$HISTORY" | python3 -c 'import json,sys; m=json.load(sys.stdin)["history"]["merges"][0]; t=m["tickets"][-1]; print(m["url"], t["name"], t["author"], t["mine"])')" "^https://github.com/acme/sandbox/pull/6 Paging the rows you True$"
expect "…what it grew from above it, each by its kind: her proposal, her plan, her review" "$(echo "$HISTORY" | python3 -c 'import json,sys; print(*[t["kind"] for t in json.load(sys.stdin)["history"]["merges"][0]["tickets"]])')" "^proposal plan review$"
expect "…and what was decided on it, and why" "$(echo "$HISTORY" | python3 -c 'import json,sys; d=json.load(sys.stdin)["history"]["merges"][0]["tickets"][2]["decisions"][0]; print(d["title"], "/", d["userWhy"])')" "^Rows a page / long lists were slow$"
expect "…a page of them, and more past it" "$(echo "$HISTORY" | python3 -c 'import json,sys; p=json.load(sys.stdin)["history"]; print(len(p["merges"]), p["more"])')" "^50 True$"
MORE=$(sfn mergeHistory "[\"$ROOM\",\"sandbox\",150,false]")
expect "scrolled on: the host's next page read, and nothing past the last" "$(echo "$MORE" | python3 -c 'import json,sys; p=json.load(sys.stdin)["history"]; print(len(p["merges"]), p["more"], p["merges"][-1]["number"])')" "^122 False 1119$"
expect "…the next page asked from where the first ended" "$(grep -c '"after=100"' "$GH/calls.log")" "^[1-9]"
expect "…#5 from no ticket" "$(echo "$HISTORY" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["history"]["merges"][1]["tickets"]))')" "^0$"
expect "a project not here has none" "$(sfn mergeHistory "[\"$ROOM\",\"elsewhere\",50,false]" | python3 -c 'import json,sys; print(json.load(sys.stdin)["history"]["none"])')" "^not here$"
expect "a room not here has no history" "$(sfn mergeHistory '["not-a-room","sandbox",50,false]')" "^null$"
echo "## her agent takes her there too"
expect "open-merges opens the project's merges page, at a merge" "$(call $A "$SA" open-merges '{"project":"SANDBOX","number":6}')" "^merges page opened: ${A%/mcp}/merges/[0-9A-Za-z-]+/sandbox#6$"
expect "…her first project's when none is named" "$(call $A "$SA" open-merges '{}')" "^merges page opened: ${A%/mcp}/merges/[0-9A-Za-z-]+/sandbox$"
expect "…a project not hers here is refused" "$(call $A "$SA" open-merges '{"project":"nope"}')" "^failed: no project of your user's named"
touch "$OUT/merges-tui.done"

HAVE_PYTE=no; python3 -c "import pyte" 2>/dev/null && HAVE_PYTE=yes
[ -n "${PYTE_PATH:-}" ] && HAVE_PYTE=yes
if [ "$HAVE_PYTE" = yes ]; then
  render() { python3 "$E2E/render.py" "$PTY" "$MARKS" "${ROWS:-30}" "${COLS:-100}" "$1"; }
  SCREEN=$(render M1_list)
  expect "the tab is in the bar" "$SCREEN" "\[3\] merges"
  expect "into the default branch" "$SCREEN" "merges into main"
  expect "the latest first, named by its pull request" "$(echo "$SCREEN" | grep -nE 'Rows a page|Fix the header' | head -1)" "Rows a page"
  expect "…its number, branch and age beside it" "$SCREEN" "Rows a page +#6 · feat/paging · "
  expect "what it grew from under it, then its review" "$(echo "$SCREEN" | grep -A1 'Rows a page' | tail -1)" "├ .+ you +Long lists in pages"
  expect "…its review last" "$(echo "$SCREEN" | grep -A3 'Rows a page' | tail -1)" "└ ± you +Paging the rows"
  expect "a merge from no ticket has nothing under it" "$(echo "$SCREEN" | grep -A1 'Fix the header' | tail -1 | grep -c '└')" "^0$"
  expect "↓ put the cursor on its review" "$(render M2_ticket_row)" "› └ ± you +Paging the rows"
  expect "esc came back to the merges, the cursor where it was" "$(render M4_back)" "› └ ± you +Paging the rows"
  expect "at the end of a page, the next is read: end reaches the very last" "$(render M6_end)" "› +Older change 120 "
else
  echo "  skip  screen-level checks (no pyte: pip install pyte, or set PYTE_PATH)"
fi
kill_all; summary
