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
printf 'export const page = (n) => n * 100;\n' > "$R/src/page.ts"
sed -i.bak '25s/line/changed, and nobody said why/' "$R/src/notes.txt"; rm -f "$R/src/notes.txt.bak"
git -C "$R" add -A; git -C "$R" commit -qm change

start alice
SA=$(mcp $A)
D1='{"what":"stream the rows","userWhy":"she said the export times out","agentWhy":"a map keeps memory flat","where":["src/export.ts:2"]}'
D2='{"what":"page by id","userWhy":"pages of a hundred","where":["src/page.ts"]}'
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
expect "the page is served, self-contained" "$(curl -s "$ORIGIN/review/$TICKET")" "<title>Review by intent</title>"
expect "a request naming another host is refused (DNS rebinding)" "$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: evil.example' "$ORIGIN/review/$TICKET/data")" "^403$"
expect "an unknown ticket is a 404" "$(curl -s -o /dev/null -w '%{http_code}' "$ORIGIN/review/not-a-ticket/data")" "^404$"
expect "the server listens on loopback only" "$(lsof -nP -iTCP:${ORIGIN##*:} -sTCP:LISTEN 2>/dev/null | grep -c 127.0.0.1)" "^[1-9]"

if [ "${KEEP:-0}" = "1" ]; then echo "KEEP: $ORIGIN/review/$TICKET"; summary; exit; fi
kill_all; summary
