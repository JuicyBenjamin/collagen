#!/bin/bash
# Why code is the way it is, from its history: alice's project is a real
# clone whose main holds #5 (a merge commit) and #6 (a squash) — the stand-in
# host (fake-gh.mjs) says so with those commits. Her review links #6. ask-why
# from a line #6 changed gives #6, her ticket and the decision about that
# file; from a line inside #5's merged branch gives #5, with no ticket; from
# the file, or from #6 by number, the same; a line a merge without a pull
# request brought has none, though #5 holds it too; a line not committed has
# no merge.
source "$(dirname "$0")/lib.sh"
kill_all; fresh_logs; prep_profiles; testnet

R="$OUT/sandbox"
g() { git -C "$R" "$@"; }
g init -q -b main; g config user.email e2e@collagen.test; g config user.name e2e
g remote add origin git@github.com:acme/sandbox.git
mkdir -p "$R/src"
printf 'export const size = 10;\nexport const page = 1;\n' > "$R/src/page.ts"
printf 'export const title = "x";\n' > "$R/src/header.ts"
g add -A; g commit -qm base
# merged by hand, no pull request: a later merge commit holds it too
g checkout -qb notes
printf 'export const note = "hi";\n' > "$R/src/notes.ts"
g add -A; g commit -qm "a note"
g checkout -q main; g merge -q --no-ff notes -m "Merge branch notes"
# #5: fix/header, merged by a merge commit
g checkout -qb fix/header
printf 'export const title = "Shop";\n' > "$R/src/header.ts"
g commit -qam "the header names the shop"; SIDE=$(g rev-parse HEAD)
g checkout -q main; g merge -q --no-ff fix/header -m "Merge pull request #5 from acme/fix/header"; M5=$(g rev-parse HEAD)
# #6: feat/paging, squashed
g checkout -qb feat/paging
printf 'export const size = 100;\nexport const page = 1;\n' > "$R/src/page.ts"
g commit -qam wip; LAST=$(g rev-parse HEAD)
g checkout -q main; g merge -q --squash feat/paging; g commit -qm "Rows a page (#6)"; S6=$(g rev-parse HEAD)
g update-ref refs/remotes/origin/main "$S6"; g symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main

GH="$OUT/gh"; mkdir -p "$GH"
python3 - "$GH/merges.json" "$M5" "$SIDE" "$S6" "$LAST" <<'PY'
import json, sys
out, m5, side, s6, last = sys.argv[1:]
def merged(n, title, head, at, oid, parents, last):
    return {"number": n, "title": title, "headRefName": head, "mergedAt": at, "updatedAt": at, "url": f"https://github.com/acme/sandbox/pull/{n}",
            "mergeCommit": {"oid": oid, "messageHeadline": title, "authoredDate": at, "parents": {"totalCount": parents}},
            "commits": {"totalCount": 1, "nodes": [{"commit": {"oid": last, "messageHeadline": "wip", "authoredDate": "2026-10-01T09:00:00Z"}}]}}
json.dump([merged(6, "Rows a page", "feat/paging", "2026-10-11T10:00:00Z", s6, 1, last), merged(5, "Fix the header", "fix/header", "2026-10-09T10:00:00Z", m5, 2, side)], open(out, "w"))
PY

COLLAGEN_GH="$E2E/fake-gh.mjs" FAKE_GH_DIR="$GH" start alice
SA=$(mcp $A)
D1='{"title":"A hundred rows a page","what":"a page holds a hundred rows","userWhy":"ten meant endless clicking","where":["src/page.ts:1"]}'
D2='{"title":"Docs","what":"the paging is documented","userWhy":"people asked","where":["docs/paging.md"]}'
ASKED=$(call $A "$SA" ask-review "{\"title\":\"Paging the rows\",\"peers\":[],\"project\":\"sandbox\",\"base\":\"main\",\"branch\":\"feat/paging\",\"link\":\"https://github.com/acme/sandbox/pull/6\",\"summary\":\"rows come a page at a time\",\"decisions\":[$D1,$D2]}")
expect "her review is on the log" "$ASKED" "review ticket filed"

echo "## from a line #6 changed"
WHY=$(call $A "$SA" ask-why "{\"file\":\"$R/src/page.ts\",\"line\":1}")
expect "the line, as git blames it" "$WHY" "asked: \"src/page.ts:1\""
expect "…merged by #6" "$WHY" "6,Rows a page,feat/paging"
expect "…from her ticket" "$WHY" "Paging the rows,you,told"
expect "…the decision about the file" "$WHY" "A hundred rows a page"
expect "…and not the one about another" "$(echo "$WHY" | grep -c 'the paging is documented')" "^0$"
expect "…which is counted" "$WHY" "1 decision\(s\), 0 fork\(s\)"

echo "## from a line inside #5's merged branch"
WHY5=$(call $A "$SA" ask-why '{"project":"sandbox","file":"src/header.ts","line":1}')
expect "the merge commit that holds it" "$WHY5" "5,Fix the header,fix/header"
expect "…from no ticket" "$WHY5" "no recorded why"

echo "## from a line a merge without a pull request brought"
expect "no merge, not the next one that holds it" "$(call $A "$SA" ask-why '{"project":"sandbox","file":"src/notes.ts","line":1}')" "pushed without a pull request"

echo "## from the file, and from #6 by number"
expect "the file: #6" "$(call $A "$SA" ask-why "{\"file\":\"$R/src/page.ts\"}")" "6,Rows a page"
expect "#6: her ticket" "$(call $A "$SA" ask-why '{"pull":6}')" "Paging the rows"
expect "a pull request not merged" "$(call $A "$SA" ask-why '{"pull":9}')" "^failed: #9 is not among"

echo "## a line not committed"
printf 'export const more = 2;\n' >> "$R/src/page.ts"
expect "has no merge" "$(call $A "$SA" ask-why "{\"file\":\"$R/src/page.ts\",\"line\":3}")" "not committed yet"
expect "a line the file has not" "$(call $A "$SA" ask-why "{\"file\":\"$R/src/page.ts\",\"line\":99}")" "^failed: git cannot blame"
kill_all; summary
