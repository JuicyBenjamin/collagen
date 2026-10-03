#!/bin/bash
# The review page on GitHub: alice's review is pull request #7 of
# acme/sandbox, and the page acts on it through the reader's own gh — here a
# stand-in (fake-gh.mjs) that answers like GitHub and logs every call, so
# nothing ever reaches GitHub. The page shows who is signed in, the pull
# request and its line comments, and the stack the branch sits in (GitHub's
# open pull requests and the room's own reviews); it sends a review — a
# comment, an approval, a request for changes — and comments on a line, at
# the commit it shows. Writes come only from the page's own origin. No CLI
# runs. KEEP=1 leaves alice running and prints the page's url.
source "$(dirname "$0")/lib.sh"
kill_all; fresh_logs; prep_profiles; testnet
[ -f "$ROOT/../review-web/dist/index.html" ] || (cd "$ROOT/../review-web" && npx vite build > /dev/null 2>&1)

echo "## alice's project: a branch of three changes, pull request #7 on GitHub"
R="$OUT/sandbox"
git -C "$R" init -q -b main
git -C "$R" config user.email e2e@collagen.test; git -C "$R" config user.name e2e
mkdir -p "$R/src"
printf 'export const a = 1;\n' > "$R/src/export.ts"
printf 'line\n%.0s' $(seq 1 30) > "$R/src/notes.txt"
git -C "$R" add -A; git -C "$R" commit -qm base
git -C "$R" checkout -qb feat/stream-export
printf 'export const a = 1;\nexport const stream = (rows) => rows.map(String);\n' > "$R/src/export.ts"
printf 'export function page(n: number): number {\n  return n * 100;\n}\n' > "$R/src/page.ts"
sed -i.bak '25s/line/changed/' "$R/src/notes.txt"; rm -f "$R/src/notes.txt.bak"
git -C "$R" add -A; git -C "$R" commit -qm change

GH="$OUT/gh"; mkdir -p "$GH"
COLLAGEN_GH="$E2E/fake-gh.mjs" FAKE_GH_DIR="$GH" start alice
SA=$(mcp $A)
D1='{"title":"Stream the rows","what":"stream the rows","userWhy":"the export times out","where":["src/export.ts:2"]}'
ask() { call $A "$SA" ask-review "$1" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1; }
TICKET=$(ask "{\"title\":\"Stream the export\",\"project\":\"sandbox\",\"base\":\"main\",\"link\":\"https://github.com/acme/sandbox/pull/7\",\"summary\":\"big exports finish\",\"decisions\":[$D1],\"forks\":[]}")
# bob's own pull request #6 is reviewed in the room too (the gh login is bob's)
OWN=$(ask "{\"title\":\"Rows a page\",\"project\":\"sandbox\",\"branch\":\"feat/paging\",\"base\":\"main\",\"link\":\"https://github.com/acme/sandbox/pull/6\",\"summary\":\"a hundred rows a page\",\"decisions\":[$D1],\"forks\":[]}")
# and a review with no pull request yet, built on #8
ask "{\"title\":\"Export docs\",\"project\":\"sandbox\",\"branch\":\"feat/docs\",\"base\":\"feat/csv\",\"summary\":\"the export documented\",\"decisions\":[$D1],\"forks\":[]}" > /dev/null
ORIGIN=${A%/mcp}
SERVER_ENTRY="$ROOT/../review-web/dist/server/entry.js"
sfn_id() { grep -oE "registerServerReference\(\"$1-[0-9a-f]+\"" "$SERVER_ENTRY" | head -1 | sed -E 's/.*"(.*)"/\1/'; }
sfn() { node "$E2E/sfn.mjs" "$ORIGIN/review/_server/data/$(sfn_id "$1")?args=$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$2")"; }
post() { node "$E2E/sfn.mjs" post "$ORIGIN/review/_server/$(sfn_id "$1")" "$2" ${3:+"$3"}; }
calls() { cat "$GH/calls.log" 2>/dev/null; }
wait_until "the review's data is served" '"commit"' sfn reviewData "[\"$TICKET\"]"
SHOWN=$(sfn reviewData "[\"$TICKET\"]" | python3 -c 'import json,sys; print(json.load(sys.stdin)["commit"])')

echo "## not signed in: the page says how to sign in, and offers nothing to send"
touch "$GH/signed-out"
OUTSIDE=$(sfn hostView "[\"$TICKET\"]")
expect "who is signed in: nobody, and how to fix it" "$OUTSIDE" '"viewer":null,"signIn":"Not signed in to GitHub \(.*gh auth login'
expect "…and a review sent anyway is refused in words" "$(post sendReview "[\"$TICKET\",\"approve\",\"\"]")" '"error":"Could not read pull request #7'
rm "$GH/signed-out"

echo "## the review on GitHub: who is signed in, its pull request, its comments, its stack"
VIEW=$(sfn hostView "[\"$TICKET\"]")
shape() { python3 -c '
import json, sys
v = json.load(sys.stdin)
print("viewer", v["viewer"]["login"], v["viewer"]["name"])
p = v["pull"]; print("pull", p["number"], p["state"], p["decision"], "mine" if p["mine"] else "theirs")
for c in v["comments"]: print("comment", c["author"]["login"], c["file"], c["side"], c["line"], c["body"])
s = v["stack"]
def step(x): return x["kind"] + ":" + str(x.get("number", x["branch"]))
print("stack", " < ".join([step(x) for x in s["below"]] + ["[" + step(s["here"]) + "]"] + [step(x) for x in s["above"]] + [("{" + " | ".join(step(x) for x in s["split"]) + "}")] * bool(s["split"])))'; }
SHAPE=$(shape <<< "$VIEW"); echo "$SHAPE" | sed 's/^/    /'
expect "signed in as the gh login, with a name and an avatar" "$VIEW" '"viewer":\{"login":"bob","name":"Bob Reviewer","avatarUrl":"http://127.0.0.1:9/bob.png"\}'
expect "the pull request the review's link names, its state and decision" "$SHAPE" "^pull 7 open review required theirs$"
expect "its line comments, on the line and side they sit on" "$SHAPE" "^comment bob src/export.ts RIGHT 2 Why map to strings here\?$"
expect "the stack: the trunk, the pull request it builds on, this one, then what builds on it — a review with no pull request yet among them" "$SHAPE" "^stack trunk:main < pull:6 < \[pull:7\] < pull:8 < review:feat/docs$"
expect "gh was asked for the pull request by the number in the link" "$(calls)" '\["pr","view","7","--repo","acme/sandbox","--json"'

echo "## a review in the reader's name"
expect "approving" "$(post sendReview "[\"$TICKET\",\"approve\",\"\"]")" '^\{"ok":true\}$'
expect "…goes to gh pr review, on the pull request found from the ticket" "$(calls)" '\["pr","review","7","--repo","acme/sandbox","--approve"\]'
expect "a comment, with its words" "$(post sendReview "[\"$TICKET\",\"comment\",\"Looks right to me\"]")" '^\{"ok":true\}$'
expect "…sent as they were written" "$(calls)" '\["pr","review","7","--repo","acme/sandbox","--comment","--body","Looks right to me"\]'
expect "requesting changes without saying which is refused before GitHub is asked" "$(post sendReview "[\"$TICKET\",\"request-changes\",\"  \"]")" '"error":"Say what should change'
expect "a verdict that is not one is a bad request" "$(post sendReview "[\"$TICKET\",\"merge\",\"\"]")" '"error":"bad request"'
expect "your own pull request is yours to comment on, not to approve" "$(sfn hostView "[\"$OWN\"]")" '"pull":\{"number":6,.*"mine":true'
expect "…approving it is refused in words, before GitHub is asked" "$(post sendReview "[\"$OWN\",\"approve\",\"\"]")" '"error":"You opened this pull request'
N=$(calls | wc -l)
expect "a write from another site is refused" "$(post sendReview "[\"$TICKET\",\"approve\",\"\"]" http://evil.example)" "^HTTP 403$"
expect "…and gh was never asked" "$(calls | wc -l | tr -d ' ')" "^$(echo $N | tr -d ' ')$"

echo "## a comment on a line, at the commit the page shows"
LINE=$(post sendLineComment "[\"$TICKET\",\"src/export.ts\",2,\"RIGHT\",\"Strings, or rows?\",\"$SHOWN\",null]")
expect "posted, and the comment comes back as GitHub has it" "$LINE" '"ok":true,"comment":\{"id":1000,"author":\{"login":"bob".*"body":"Strings, or rows\?","file":"src/export.ts","line":2,"side":"RIGHT"'
expect "…on that file, line and side, at the commit the page shows" "$(calls | tail -1)" "\"-f\",\"body=Strings, or rows\\?\",\"-f\",\"commit_id=$SHOWN\",\"-f\",\"path=src/export.ts\",\"-F\",\"line=2\",\"-f\",\"side=RIGHT\""
expect "…and read back with the others" "$(sfn hostView "[\"$TICKET\"]" | shape)" "^comment bob src/export.ts RIGHT 2 Strings, or rows\?$"
BLOCK_ARGS=$(python3 -c 'import json, sys; print(json.dumps([sys.argv[1], "src/page.ts", 3, "RIGHT", "Name the size:\n```suggestion\n  return n * PAGE;\n}\n```", sys.argv[2], {"line": 2, "side": "RIGHT"}]))' "$TICKET" "$SHOWN")
BLOCK=$(post sendLineComment "$BLOCK_ARGS")
expect "a comment on a block of lines, with a suggested change in it" "$BLOCK" '"ok":true,"comment":\{.*"file":"src/page.ts","line":3,"side":"RIGHT","startLine":2,"startSide":"RIGHT"'
expect "…sent from its first line to its last" "$(calls | tail -1)" '"-F","line=3","-f","side=RIGHT","-F","start_line=2","-f","start_side=RIGHT"\]'
expect "…its suggestion sent as written" "$(calls | tail -1)" 'suggestion\\n  return n \* PAGE;'
expect "a block that starts after it ends is a bad request" "$(post sendLineComment "[\"$TICKET\",\"src/page.ts\",2,\"RIGHT\",\"x\",\"$SHOWN\",{\"line\":3,\"side\":\"RIGHT\"}]")" '"error":"bad request"'
expect "a line GitHub does not take is refused in its words" "$(post sendLineComment "[\"$TICKET\",\"src/notes.txt\",25,\"RIGHT\",\"hm\",\"$SHOWN\",null]")" '"error":"Validation Failed"'
expect "an empty comment is refused before GitHub is asked" "$(post sendLineComment "[\"$TICKET\",\"src/export.ts\",2,\"RIGHT\",\"   \",\"$SHOWN\",null]")" '"error":"Write the comment first."'
expect "a side that is not one is a bad request" "$(post sendLineComment "[\"$TICKET\",\"src/export.ts\",2,\"MIDDLE\",\"x\",\"$SHOWN\",null]")" '"error":"bad request"'
expect "a path out of the tree is a bad request" "$(post sendLineComment "[\"$TICKET\",\"../etc/passwd\",2,\"RIGHT\",\"x\",\"$SHOWN\",null]")" '"error":"bad request"'
expect "a commit that is not one is a bad request" "$(post sendLineComment "[\"$TICKET\",\"src/export.ts\",2,\"RIGHT\",\"x\",\"HEAD\",null]")" '"error":"bad request"'

if [ "${KEEP:-0}" = "1" ]; then echo "KEEP: $ORIGIN/review/$TICKET"; summary; exit; fi
kill_all; summary
