#!/bin/bash
# The review page: a review read by intent, not by filename. alice's project
# is a real git repo with a branch off main; she asks for a review with the
# why pointing at the lines it produced. The instance serves /review/<id>:
# the diff from her own clone (git diff main...branch), each hunk under the
# decision whose `where` claims it, a fork beside the hunk it sits in, and
# the hunk no decision claims under "not explained". Loopback only, and a
# request naming another host is refused. KEEP=1 leaves alice running and
# prints the page's url, to look at it in a browser. No CLI runs.
source "$(dirname "$0")/lib.sh"
kill_all; fresh_logs; prep_profiles; testnet
# the page is a Solid app served from its build; build it if this checkout has not
[ -f "$ROOT/../review-web/dist/index.html" ] || (cd "$ROOT/../review-web" && npx vite build > /dev/null 2>&1)

echo "## alice's project: a repo, a branch with three changes off main"
R="$OUT/sandbox"
git -C "$R" init -q -b main
git -C "$R" config user.email e2e@collagen.test; git -C "$R" config user.name e2e
mkdir -p "$R/src"
printf 'export const a = 1;\n' > "$R/src/export.ts"
printf 'line\n%.0s' $(seq 1 30) > "$R/src/notes.txt"
git -C "$R" add -A; git -C "$R" commit -qm base
git -C "$R" checkout -qb feat/stream-export
printf 'export const a = 1;\nexport const stream = (rows) => rows.map(String);\n' > "$R/src/export.ts"
printf '/** A hundred rows a page. */\nexport function page(n: number): number {\n  return n * 100;\n}\n' > "$R/src/page.ts"
printf 'import { page } from "./page";\nimport { stream } from "./export";\nexport const first = stream([page(1)]);\n' > "$R/src/use.ts"
sed -i.bak '25s/line/changed, and nobody said why/' "$R/src/notes.txt"; rm -f "$R/src/notes.txt.bak"
git -C "$R" add -A; git -C "$R" commit -qm change

# the type hints need collagen's pinned TypeScript, normally installed on
# the person's click; here the repo's own stands in, so no network is needed
COLLAGEN_TYPESCRIPT="$ROOT/node_modules/typescript" start alice
SA=$(mcp $A)
D1='{"title":"Stream the rows","what":"stream the rows","userWhy":"she said the export times out","agentWhy":"a map keeps memory flat","where":["src/export.ts:2"]}'
D2='{"title":"Page by id","what":"page by id","userWhy":"pages of a hundred","where":["src/page.ts"]}'
F1='{"at":"src/export.ts:2","chose":"map to strings","instead":"a csv library","why":"no new dependency","by":"agent"}'
ASK="{\"project\":\"sandbox\",\"base\":\"main\",\"summary\":\"stream the export\",\"decisions\":[$D1,$D2],\"forks\":[$F1]}"
TICKET=$(call $A "$SA" ask-review "$ASK" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
ORIGIN=${A%/mcp}

echo "## the page's data: the diff from the clone, grouped by the why"
wait_until "the review's data is served" "\"sections\"" curl -s "$ORIGIN/review/$TICKET/data"
DATA=$(curl -s "$ORIGIN/review/$TICKET/data")
SHAPE=$(python3 -c '
import json, sys
d = json.loads(sys.stdin.read()); g = d["grouped"]
print("source", d["source"]["kind"], d["source"]["detail"])
for s in g["sections"]:
    print(s["decision"]["id"], "hunks", " ".join(s["hunks"]), "forks", " ".join(f["id"] for f in s["forks"]))
print("unexplained", " ".join(g["unexplained"]))' <<< "$DATA")
echo "$SHAPE" | sed 's/^/    /'
expect "read from alice's own clone, main...branch" "$SHAPE" "source clone main...feat/stream-export from your clone"
expect "d1 holds the export hunk, and the fork that sits in it" "$SHAPE" "d1 hunks src/export.ts#[0-9]+ forks f1"
expect "d2 holds the new file" "$SHAPE" "d2 hunks src/page.ts#[0-9]+ forks $"
expect "the change nobody explained is its own finding" "$SHAPE" "unexplained src/notes.txt#[0-9]+"

echo "## the page itself"
PAGE=$(curl -s "$ORIGIN/review/$TICKET")
expect "the page is served: the Solid app's document" "$PAGE" "<title>Review by intent</title>"
ASSET=$(echo "$PAGE" | grep -oE '/review/assets/[A-Za-z0-9_.-]+\.js' | head -1)
expect "…and its script, from the build, as JavaScript" "$(curl -s -o /dev/null -w '%{http_code} %{content_type}' "$ORIGIN$ASSET")" "^200 text/javascript"
expect "nothing outside the build is served as an asset" "$(curl -s -o /dev/null -w '%{http_code}' "$ORIGIN/review/assets/..%2Fpackage.json")" "^404$"
expect "a request naming another host is refused (DNS rebinding)" "$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: evil.example' "$ORIGIN/review/$TICKET/data")" "^403$"
expect "an unknown ticket is a 404" "$(curl -s -o /dev/null -w '%{http_code}' "$ORIGIN/review/not-a-ticket/data")" "^404$"
expect "the server listens on loopback only" "$(lsof -nP -iTCP:${ORIGIN##*:} -sTCP:LISTEN 2>/dev/null | grep -c 127.0.0.1)" "^[1-9]"

echo "## types and definitions, from collagen's own TypeScript 7 over the branch"
expect "the page can see the pinned TypeScript is there" "$(curl -s "$ORIGIN/review-tools/typescript")" "\"version\":\"7\.[^\"]*\".*\"state\":\"ready\""
expect "…a tool collagen does not have is not there" "$(curl -s -o /dev/null -w '%{http_code}' "$ORIGIN/review-tools/cobol")" "^404$"
expect "installing is refused without the page's header (a form elsewhere cannot)" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$ORIGIN/review-tools/typescript")" "^403$"
expect "…and from another origin, header or not" "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'x-collagen: install' -H 'Origin: https://evil.example' "$ORIGIN/review-tools/typescript")" "^403$"
HOVER=$(curl -s -m 60 "$ORIGIN/review/$TICKET/hover?file=src/use.ts&line=3&col=21")
expect "hovering a call says what it is: its signature" "$HOVER" "const stream: \\(rows"
PEEK=$(curl -s -m 60 "$ORIGIN/review/$TICKET/definition?file=src/use.ts&line=3&col=29")
expect "peeking it opens the declaration in its own file" "$PEEK" "\"file\":\"src/page.ts\".*export function page"
expect "…with the doc comment above it" "$PEEK" "A hundred rows a page"
expect "a path outside the branch is refused" "$(curl -s -o /dev/null -w '%{http_code}' "$ORIGIN/review/$TICKET/hover?file=../../etc/passwd.ts&line=1&col=0")" "^400$"
expect "…and so is a file the type checker does not read" "$(curl -s -o /dev/null -w '%{http_code}' "$ORIGIN/review/$TICKET/hover?file=src/notes.txt&line=1&col=0")" "^400$"
expect "…and a hover from another host" "$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: evil.example' "$ORIGIN/review/$TICKET/hover?file=src/use.ts&line=3&col=21")" "^403$"
expect "your clone was not touched: no worktree, nothing staged" "$(git -C "$R" worktree list | wc -l | tr -d ' ')$(git -C "$R" status --porcelain | wc -l | tr -d ' ')" "^10$"

echo "## the page is kept current: the instance says when the review changes"
EV="$OUT/events.txt"; rm -f "$EV"
curl -s -N -m 40 "$ORIGIN/review/$TICKET/events" > "$EV" &
CURL=$!; disown
wait_until "the stream is open" "retry:" cat "$EV"
D3='{"title":"The export streams in","what":"the export streams in pages","userWhy":"she asked for it"}'
AMEND="{\"ticketId\":\"$TICKET\",\"decisions\":[$D3]}"
call $A "$SA" ask-review "$AMEND" > /dev/null
wait_until "revising the why says changed" "event: changed" cat "$EV"
BEFORE=$(grep -c "event: changed" "$EV")
printf 'export const more = 1;\n' > "$R/src/more.ts"; git -C "$R" add -A; git -C "$R" commit -qm more
wait_until "a new commit on the branch says changed too" "^$((BEFORE + 1))$" grep -c "event: changed" "$EV"
expect "…and the data now has it" "$(curl -s "$ORIGIN/review/$TICKET/data")" "src/more.ts"
kill $CURL 2>/dev/null
# o on a review open where its tab cannot be brought forward opens one
# marked ?take, which the old tab hands over to: the marker serves the page
expect "a tab marked to take over is the same page" "$(curl -s "$ORIGIN/review/$TICKET?take")" "<title>Review by intent</title>"

if [ "${KEEP:-0}" = "1" ]; then echo "KEEP: $ORIGIN/review/$TICKET"; summary; exit; fi
kill_all; summary
