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
# a finish from the page: its own id (fresh unless given) and the pending comments it shows
seen() { python3 -c 'import json,sys,uuid; v=json.loads(sys.argv[1]); print(json.dumps({"id": sys.argv[2] or str(uuid.uuid4()), "pending": [p["id"] for p in v["pending"]]}, separators=(",", ":")))' "$(sfn talkView "[\"$1\"]")" "${2:-}"; }
submit() { post submitReview "[\"$1\",\"$2\",\"$3\",${4:-null},${5:-null},$(seen "$1" "${6:-}")]"; }
reviewed() { tail -1 "$GH/reviews.log" 2>/dev/null; }
wait_until "the review's data is served" '"commit"' sfn reviewData "[\"$TICKET\"]"
SHOWN=$(sfn reviewData "[\"$TICKET\"]" | python3 -c 'import json,sys; print(json.load(sys.stdin)["commit"])')

echo "## not signed in: the page says how to sign in, and offers nothing to send"
touch "$GH/signed-out"
OUTSIDE=$(sfn hostView "[\"$TICKET\"]")
expect "who is signed in: nobody, and how to fix it" "$OUTSIDE" '"viewer":null,"signIn":"Not signed in to GitHub \(.*gh auth login'
expect "…and a review sent anyway is refused in words" "$(submit "$TICKET" approve "")" '"error":"Cannot approve here — Could not read pull request #7: .*gh auth login'
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
expect "a reply sits on its line, knowing what it answers" "$VIEW" '"body":"Agreed — rows, please.","file":"src/export.ts","line":2,"side":"RIGHT","url":"[^"]*","at":"[^"]*","replyTo":"900"'
expect "the reviews on it, with their verdicts and words" "$VIEW" '"reviews":\[\{"id":"98","author":\{"login":"carol","avatarUrl":"http://127.0.0.1:9/carol.png"\},"verdict":"approved","body":"Good to go."'
expect "its conversation, and a line comment on code changed since, oldest first" "$VIEW" '"conversation":\[\{"id":"77","author":\{"login":"carol"\},"body":"Can this ship Friday\?".*\{"id":"901",.*"body":"old note".*"outdated":"src/export.ts, line 1"\}\]'
expect "…and when GitHub was asked" "$VIEW" '"checkedAt":"20[0-9]{2}-'
expect "gh was asked for the pull request by the number in the link" "$(calls)" '\["pr","view","7","--repo","acme/sandbox","--json"'

echo "## a review in the reader's name, finished at once"
expect "approving, with nothing pending" "$(submit "$TICKET" approve "")" '^\{"ok":true,"said":0,"url":"https://github.com/acme/sandbox/pull/7#pullrequestreview-500"\}$'
expect "…goes to GitHub as one review, on the pull request found from the ticket" "$(calls | grep -c '"api","-X","POST","repos/acme/sandbox/pulls/7/reviews","--input","-"')" "^1$"
expect "…an approval, at the commit the page shows" "$(reviewed)" "^\{\"commit_id\":\"$SHOWN\",\"event\":\"APPROVE\",\"comments\":\[\]\}$"
expect "a comment on the whole, with its words" "$(submit "$TICKET" comment "Looks right to me" "\"$SHOWN\"")" '"ok":true,"said":0'
expect "…sent as they were written" "$(reviewed)" '"event":"COMMENT","body":"Looks right to me"'
expect "requesting changes without saying which is refused before GitHub is asked" "$(submit "$TICKET" request-changes "  ")" '"error":"Say what should change'
expect "a comment saying nothing, with nothing pending, is refused" "$(submit "$TICKET" comment "")" '"error":"Write something, or add comments to your review first."'
expect "a verdict that is not one is a bad request" "$(submit "$TICKET" merge "")" '"error":"bad request"'
expect "your own pull request is yours to comment on, not to approve" "$(sfn hostView "[\"$OWN\"]")" '"pull":\{"number":6,.*"mine":true'
expect "…approving it is refused in words, before GitHub is asked" "$(submit "$OWN" approve "")" '"error":"Cannot approve here — it is your own pull request'
N=$(calls | wc -l)
expect "a comment on your own pull request is kept in collagen" "$(post sendLineComment "[\"$OWN\",\"src/export.ts\",2,\"RIGHT\",\"note to self\",\"$SHOWN\",null,null]")" '"ok":true,"comment":\{"id":"[0-9a-f-]+","author":\{"login":"alice"\},"body":"note to self"'
expect "…and never posted to GitHub, where you would be its only reader" "$(calls | sed -n "$((N + 1)),\$p" | grep -c POST)" "^0$"
N=$(calls | wc -l)
expect "a write from another site is refused" "$(post submitReview "[\"$TICKET\",\"approve\",\"\",null,null,{\"id\":\"0123abcd\",\"pending\":[]}]" http://evil.example)" "^HTTP 403$"
expect "…and gh was never asked" "$(calls | wc -l | tr -d ' ')" "^$(echo $N | tr -d ' ')$"

echo "## a write goes out under whoever gh is signed in as now"
N=$(calls | wc -l)
expect "the page showed someone else: refused, saying who it is now" "$(submit "$TICKET" approve "" null '"carol"')" '"error":"gh is signed in as bob now, not carol as the page showed'
expect "…gh asked right then, not remembered" "$(calls | sed -n "$((N + 1)),\$p" | grep -c '"api","user"')" "^1$"
expect "…and nothing posted" "$(calls | sed -n "$((N + 1)),\$p" | grep -c POST)" "^0$"

echo "## a single comment on a line, said at once, at the commit the page shows"
LINE=$(post sendLineComment "[\"$TICKET\",\"src/export.ts\",2,\"RIGHT\",\"Strings, or rows?\",\"$SHOWN\",null,\"bob\"]")
expect "posted, and the comment comes back as GitHub has it" "$LINE" '"ok":true,"comment":\{"id":"1000","author":\{"login":"bob".*"body":"Strings, or rows\?","file":"src/export.ts","line":2,"side":"RIGHT"'
expect "…on that file, line and side, at the commit the page shows" "$(calls | tail -1)" "\"-f\",\"body=Strings, or rows\\?\",\"-f\",\"commit_id=$SHOWN\",\"-f\",\"path=src/export.ts\",\"-F\",\"line=2\",\"-f\",\"side=RIGHT\""
expect "…and read back with the others" "$(sfn hostView "[\"$TICKET\"]" | shape)" "^comment bob src/export.ts RIGHT 2 Strings, or rows\?$"
BLOCK_ARGS=$(python3 -c 'import json, sys; print(json.dumps([sys.argv[1], "src/page.ts", 3, "RIGHT", "Name the size:\n```suggestion\n  return n * PAGE;\n}\n```", sys.argv[2], {"line": 2, "side": "RIGHT"}, "bob"]))' "$TICKET" "$SHOWN")
BLOCK=$(post sendLineComment "$BLOCK_ARGS")
expect "a comment on a block of lines, with a suggested change in it" "$BLOCK" '"ok":true,"comment":\{.*"file":"src/page.ts","line":3,"side":"RIGHT","startLine":2,"startSide":"RIGHT"'
expect "…sent from its first line to its last" "$(calls | tail -1)" '"-F","line=3","-f","side=RIGHT","-F","start_line=2","-f","start_side=RIGHT"\]'
expect "…its suggestion sent as written" "$(calls | tail -1)" 'suggestion\\n  return n \* PAGE;'
expect "a block that starts after it ends is a bad request" "$(post sendLineComment "[\"$TICKET\",\"src/page.ts\",2,\"RIGHT\",\"x\",\"$SHOWN\",{\"line\":3,\"side\":\"RIGHT\"},null]")" '"error":"bad request"'
expect "a line GitHub does not take is refused in its words" "$(post sendLineComment "[\"$TICKET\",\"src/notes.txt\",25,\"RIGHT\",\"hm\",\"$SHOWN\",null,null]")" '"error":"Validation Failed"'
expect "an empty comment is refused before GitHub is asked" "$(post sendLineComment "[\"$TICKET\",\"src/export.ts\",2,\"RIGHT\",\"   \",\"$SHOWN\",null,null]")" '"error":"Write the comment first."'
expect "a side that is not one is a bad request" "$(post sendLineComment "[\"$TICKET\",\"src/export.ts\",2,\"MIDDLE\",\"x\",\"$SHOWN\",null,null]")" '"error":"bad request"'
expect "a path out of the tree is a bad request" "$(post sendLineComment "[\"$TICKET\",\"../etc/passwd\",2,\"RIGHT\",\"x\",\"$SHOWN\",null,null]")" '"error":"bad request"'
expect "a commit that is not one is a bad request" "$(post sendLineComment "[\"$TICKET\",\"src/export.ts\",2,\"RIGHT\",\"x\",\"HEAD\",null,null]")" '"error":"bad request"'

echo "## the reader's AI drafts its comments; they wait on the page, beside the code"
talk() { sfn talkView "[\"$1\"]"; }
count() { python3 -c 'import json,sys; v=json.load(sys.stdin); print(len(v[sys.argv[1]]))' "$1"; }
DRAFTS='[{"file":"src/export.ts","line":2,"body":"Strings lose the row shape — keep objects?"},{"file":"src/page.ts","startLine":2,"line":3,"body":"Name the size:\n```suggestion\n  return n * PAGE;\n}\n```"},{"file":"src/export.ts","line":40,"body":"far away"}]'
DRAFTED=$(call $A "$SA" review-comments "{\"action\":\"draft\",\"ticketId\":\"$TICKET\",\"comments\":$DRAFTS}")
expect "two drafted, under the lines they are about" "$DRAFTED" "^2 draft comment\(s\) on the review page"
expect "…one the diff cannot place refused, saying what it shows" "$DRAFTED" "#3 \(src/export.ts:40\): src/export.ts line \+40 is not in the diff — it shows \+1–2"
expect "…and the agent told to leave them out of the chat" "$DRAFTED" "Do not repeat the comments in the chat"
TALK=$(talk "$TICKET")
expect "the page reads them: one on a line, one on a block of lines — nothing pending yet" "$TALK" '"drafts":\[\{"id":"[0-9a-f-]+","commit":"'"$SHOWN"'","file":"src/export.ts","line":2,"side":"RIGHT","body":"Strings lose.*\{"id":"[0-9a-f-]+","commit":"'"$SHOWN"'","file":"src/page.ts","line":3,"side":"RIGHT","startLine":2,"startSide":"RIGHT".*\],"pending":\[\]'
DID=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["drafts"][0]["id"])' <<< "$TALK")
N=$(calls | wc -l)
expect "accepting one on the page, as the reader edited it, puts it in their review" "$(post acceptDrafts "[\"$TICKET\",[\"$DID\"],{\"$DID\":\"Strings lose the row shape: keep the objects.\"}]")" '^\{"done":1,"failed":\[\]\}$'
TALK=$(talk "$TICKET")
expect "…pending there, in their words, marked as the AI's" "$TALK" '"pending":\[\{"id":"[0-9a-f-]+","commit":"'"$SHOWN"'","file":"src/export.ts","line":2,"side":"RIGHT","body":"Strings lose the row shape: keep the objects.","drafted":true\}\]'
expect "…one draft left" "$(count drafts <<< "$TALK")" "^1$"
expect "a comment the reader writes goes into the review too" "$(post addToReview "[\"$TICKET\",\"src/use.ts\",3,\"RIGHT\",\"Does first need exporting?\",\"$SHOWN\",null]")" '^\{"ok":true\}$'
PID=$(python3 -c 'import json,sys; v=json.load(sys.stdin); print([p["id"] for p in v["pending"] if p["file"] == "src/use.ts"][0])' <<< "$(talk "$TICKET")")
expect "…and can be reworded while it is pending" "$(post editDraft "[\"$TICKET\",\"$PID\",\"Does first need to be exported?\"]")" '^\{"done":1,"failed":\[\]\}$'
expect "nothing pending has reached GitHub" "$(calls | sed -n "$((N + 1)),\$p" | grep -c POST)" "^0$"
AGENTACC=$(call $A "$SA" review-comments "{\"action\":\"accept\",\"ticketId\":\"$TICKET\"}")
expect "the agent puts the rest in the review on its person's word" "$AGENTACC" "^1 draft\(s\) put into your user's review — 3 comment\(s\) pending in it"
FINISHED=$(call $A "$SA" review-comments "{\"action\":\"submit\",\"ticketId\":\"$TICKET\",\"body\":\"Close — two questions.\"}")
expect "…and finishes it: every pending comment said, the review on the pull request" "$FINISHED" "^review finished: 3 comment\(s\) said in the room as your user's, and the review is on the pull request: https://github.com/acme/sandbox/pull/7#pullrequestreview-50[0-9]"
REVIEW=$(reviewed)
expect "a finished review is read back among the reviews, its verdict and words" "$(sfn hostView "[\"$TICKET\"]")" '"verdict":"commented","body":"Close — two questions."' 
expect "…one review on GitHub: its words, a comment, every comment in it" "$REVIEW" '"event":"COMMENT","body":"Close — two questions.","comments":\[\{"path":"src/export.ts","line":2,"side":"RIGHT","body":"Strings lose the row shape: keep the objects."\},\{"path":"src/page.ts","line":3,"side":"RIGHT","body":"Name the size:.*","start_line":2,"start_side":"RIGHT"\},\{"path":"src/use.ts","line":3,"side":"RIGHT","body":"Does first need to be exported\?"\}\]'
TALK=$(talk "$TICKET")
expect "…said in the room, each with where it is on GitHub, the AI's marked" "$TALK" '"said":\[.*\{"id":"[0-9a-f-]+","author":\{"login":"alice"\},"body":"Strings lose the row shape: keep the objects.","file":"src/export.ts","line":2,"side":"RIGHT","url":"[^"]+","at":"[^"]+","drafted":true,"hostId":"[0-9]+"\}'
expect "…nothing pending any more" "$(count pending <<< "$TALK")" "^0$"
CONTEXT=$(call $A "$SA" review-context "{\"ticketId\":\"$TICKET\"}")
expect "the author's agent reads them in review-context" "$CONTEXT" '^comments\[5\]\{by,at,body,onHost\}:$'
expect "…each with where it is on GitHub" "$CONTEXT" 'alice,"src/use.ts:3",Does first need to be exported\?,"https://github.com/acme/sandbox/pull/7#discussion_r[0-9]+"$'
call $A "$SA" review-comments "{\"action\":\"draft\",\"ticketId\":\"$TICKET\",\"comments\":[{\"file\":\"src/page.ts\",\"line\":1,\"body\":\"nit\"}]}" > /dev/null
expect "declining on the page drops a draft, said nowhere" "$(post dropDrafts "[\"$TICKET\",null,\"ai\"]")" "^1$"
post addToReview "[\"$TICKET\",\"src/page.ts\",1,\"RIGHT\",\"second thoughts\",\"$SHOWN\",null]" > /dev/null
expect "discarding the review drops what is pending in it" "$(post dropDrafts "[\"$TICKET\",null,\"pending\"]")" "^1$"
expect "…nothing left" "$(talk "$TICKET")" '^\{"drafts":\[\],"pending":\[\]'

echo "## a comment written at another commit waits on the reader before it is said"
OLD=0123456789abcdef0123456789abcdef01234567
post addToReview "[\"$TICKET\",\"src/export.ts\",2,\"RIGHT\",\"from before\",\"$OLD\",null]" > /dev/null
N=$(calls | wc -l)
expect "finishing at the commit the page shows refuses it, saying why" "$(submit "$TICKET" comment "" "\"$SHOWN\"")" '"error":"1 comment\(s\) in your review were written on another commit than the one the page shows'
expect "…nothing posted" "$(calls | sed -n "$((N + 1)),\$p" | grep -c POST)" "^0$"
TALK=$(talk "$TICKET")
expect "…still pending, saying where it was written" "$TALK" "\"pending\":\[\{\"id\":\"[0-9a-f-]+\",\"commit\":\"$OLD\""
MID=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["pending"][0]["id"])' <<< "$TALK")
expect "the reader confirms where it sits" "$(post repinDraft "[\"$TICKET\",\"$MID\",\"$SHOWN\"]")" '^\{"done":1,"failed":\[\]\}$'

echo "## two tabs finish the same review at once: it is said once"
REVIEWS() { calls | grep -c '"POST","repos/acme/sandbox/pulls/7/reviews"'; }
N=$(REVIEWS)
TAB1=$(seen "$TICKET"); TAB2=$(seen "$TICKET")
post submitReview "[\"$TICKET\",\"comment\",\"Both tabs say this\",\"$SHOWN\",null,$TAB1]" > "$OUT/finish1" & F1=$!
post submitReview "[\"$TICKET\",\"comment\",\"Both tabs say this\",\"$SHOWN\",null,$TAB2]" > "$OUT/finish2" & F2=$!
wait $F1 $F2
expect "one finishes it" "$(cat "$OUT/finish1" "$OUT/finish2" | grep -c '"ok":true,"said":1')" "^1$"
expect "…the other finds the review changed under it, and says nothing" "$(cat "$OUT/finish1" "$OUT/finish2")" 'Your review changed since the page last read it'
expect "…one review on GitHub" "$(REVIEWS)" "^$((N + 1))$"
expect "…said once in the room" "$(talk "$TICKET" | grep -o '"body":"from before"' | wc -l | tr -d ' ')" "^1$"

echo "## the same finish sent again is not said again"
N=$(REVIEWS)
expect "an approval with words" "$(submit "$TICKET" approve "Ship it." "\"$SHOWN\"" null 5eed0001-0000-4000-8000-000000000001)" '"ok":true,"said":0,"url"'
expect "…sent again (a retry, a second click): done already, nothing said" "$(submit "$TICKET" approve "Ship it." "\"$SHOWN\"" null 5eed0001-0000-4000-8000-000000000001)" '^\{"ok":true,"said":0,"already":true\}$'
expect "…one review on GitHub" "$(REVIEWS)" "^$((N + 1))$"

echo "## a comment deleted while GitHub takes the review waits for it"
post addToReview "[\"$TICKET\",\"src/export.ts\",2,\"RIGHT\",\"on its way\",\"$SHOWN\",null]" > /dev/null
touch "$GH/slow-review"
submit "$TICKET" comment "" "\"$SHOWN\"" > "$OUT/finish3" & F3=$!
sleep 0.5
DROPPED=$(post dropDrafts "[\"$TICKET\",null,\"pending\"]")
wait $F3
rm "$GH/slow-review"
expect "the finish says it" "$(cat "$OUT/finish3")" '"ok":true,"said":1'
expect "…the delete, waiting its turn, finds nothing left to delete" "$DROPPED" "^0$"
expect "…in the room as on GitHub" "$(talk "$TICKET")" '"body":"on its way"'

expect "a draft on a ticket that is not one is refused" "$(call $A "$SA" review-comments "{\"action\":\"submit\",\"ticketId\":\"nope\"}")" "^failed: no ticket nope"

echo "## a review with no pull request: comments are said in the room alone"
BARE_ASK=$(call $A "$SA" ask-review "{\"title\":\"Stream it, unhosted\",\"project\":\"sandbox\",\"branch\":\"feat/stream-export\",\"base\":\"main\",\"summary\":\"the same change, no host\",\"decisions\":[$D1],\"forks\":[]}")
BARE=$(echo "$BARE_ASK" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
call $A "$SA" review-comments "{\"action\":\"draft\",\"ticketId\":\"$BARE\",\"comments\":[{\"file\":\"src/export.ts\",\"line\":2,\"body\":\"room only\"}]}" > /dev/null
call $A "$SA" review-comments "{\"action\":\"accept\",\"ticketId\":\"$BARE\"}" > /dev/null
N=$(calls | wc -l)
expect "a verdict has nowhere to go" "$(submit "$BARE" approve "")" '"error":"Cannot approve here — the review names no pull request'
expect "words on the whole have nowhere to go either: refused, nothing said" "$(submit "$BARE" comment "Looks fine overall")" '"error":"Words on the whole have nowhere to go here — the review names no pull request'
expect "…the review still pending" "$(talk "$BARE" | count pending)" "^1$"
expect "finished, the review is said in the room only, and why" "$(call $A "$SA" review-comments "{\"action\":\"submit\",\"ticketId\":\"$BARE\"}")" "^review finished: 1 comment\(s\) said in the room as your user's — not on GitHub: the review names no pull request"
expect "…GitHub never asked to post" "$(calls | sed -n "$((N + 1)),\$p" | grep -c POST)" "^0$"
expect "a comment typed on its page is said in the room too" "$(post sendLineComment "[\"$BARE\",\"src/export.ts\",1,\"RIGHT\",\"typed here\",\"$SHOWN\",null,null]")" '"ok":true,"comment":\{"id":"[0-9a-f-]+","author":\{"login":"alice"\},"body":"typed here"'
expect "…and read back on the page" "$(talk "$BARE")" '"body":"room only".*"body":"typed here"'

if [ "${KEEP:-0}" = "1" ]; then echo "KEEP: $ORIGIN/review/$TICKET"; summary; exit; fi
kill_all; summary
