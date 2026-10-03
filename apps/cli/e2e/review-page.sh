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
# PHP's is Intelephense at its pinned version, fetched once into the test
# output (npm's registry, the same command the page's install runs) and kept
IP_VERSION=$(cd "$ROOT" && node --import tsx -e 'import("./src/lib/languageTools.ts").then((m) => console.log(m.TOOLS.php.version))')
IP="$ROOT_OUT/tools/intelephense-$IP_VERSION"
[ -f "$IP/node_modules/intelephense/lib/intelephense.js" ] || npm install --prefix "$IP" --no-save --no-package-lock --no-audit --no-fund --ignore-scripts --loglevel=error "intelephense@$IP_VERSION" > /dev/null 2>&1
COLLAGEN_TYPESCRIPT="$ROOT/node_modules/typescript" COLLAGEN_INTELEPHENSE="$IP/node_modules/intelephense" start alice
SA=$(mcp $A)
D1='{"title":"Stream the rows","what":"stream the rows","userWhy":"she said the export times out","agentWhy":"a map keeps memory flat","where":["src/export.ts:2"],"guidedBy":["CLAUDE.md"]}'
D2='{"title":"Page by id","what":"page by id","userWhy":"pages of a hundred","where":["src/page.ts"]}'
F1='{"at":"src/export.ts:2","chose":"map to strings","instead":"a csv library","why":"no new dependency","by":"agent"}'
ASK="{\"title\":\"Stream the export\",\"project\":\"sandbox\",\"base\":\"main\",\"summary\":\"stream the export\",\"decisions\":[$D1,$D2],\"forks\":[$F1]}"
TICKET=$(call $A "$SA" ask-review "$ASK" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
ORIGIN=${A%/mcp}
# the page's server functions, called as the page calls them: by name (the
# build gives each a stable id), the arguments as JSON — a read is a GET
SERVER_ENTRY="$ROOT/../review-web/dist/server/entry.js"
sfn_id() { grep -oE "registerServerReference\(\"$1-[0-9a-f]+\"" "$SERVER_ENTRY" | head -1 | sed -E 's/.*"(.*)"/\1/'; }
sfn_url() { echo "$ORIGIN/review/_server/${3:-data}/$(sfn_id "$1")?args=$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$2")"; }
sfn() { node "$E2E/sfn.mjs" "$(sfn_url "$1" "$2")"; }

echo "## the page's data: the diff from the clone, grouped by the why"
wait_until "the review's data is served" "\"sections\"" sfn reviewData "[\"$TICKET\"]"
DATA=$(sfn reviewData "[\"$TICKET\"]")
expect "a decision carries what guided it to the page" "$DATA" '"guidedBy":\["CLAUDE.md"\]'
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
expect "a call naming another host is refused (DNS rebinding)" "$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: evil.example' "$(sfn_url reviewData "[\"$TICKET\"]")")" "^403$"
expect "an unknown ticket has no data" "$(sfn reviewData '["not-a-ticket"]')" "^null$"
expect "the review's old routes are gone: the page talks through server functions" "$(curl -s -o /dev/null -w '%{http_code}' "$ORIGIN/review/$TICKET/data")" "^404$"
expect "the server listens on loopback only" "$(lsof -nP -iTCP:${ORIGIN##*:} -sTCP:LISTEN 2>/dev/null | grep -c 127.0.0.1)" "^[1-9]"

echo "## types and definitions, from collagen's own TypeScript 7 over the branch"
expect "the page can see the pinned TypeScript is there" "$(sfn toolState '["typescript"]')" "\"version\":\"7\.[^\"]*\".*\"state\":\"ready\""
expect "…a tool collagen does not have is not there" "$(sfn toolState '["cobol"]')" "^null$"
expect "installing from another origin is refused (Solid's same-origin guard)" "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -H 'Origin: https://evil.example' --data '["typescript"]' "$ORIGIN/review/_server/$(sfn_id installTool)")" "^403$"
HOVER=$(sfn hoverAt "[\"$TICKET\",\"src/use.ts\",3,21]")
expect "hovering a call says what it is: its signature" "$HOVER" "const stream: \\(rows"
PEEK=$(sfn definitionAt "[\"$TICKET\",\"src/use.ts\",3,29]")
expect "peeking it opens the declaration in its own file" "$PEEK" "\"file\":\"src/page.ts\".*export function page"
expect "…with the doc comment above it" "$PEEK" "A hundred rows a page"
expect "a path outside the branch is refused" "$(sfn hoverAt "[\"$TICKET\",\"../../etc/passwd.ts\",1,0]")" "bad request"
expect "…and so is a file the type checker does not read" "$(sfn hoverAt "[\"$TICKET\",\"src/notes.txt\",1,0]")" "bad request"
expect "…and a hover from another host" "$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: evil.example' "$(sfn_url hoverAt "[\"$TICKET\",\"src/use.ts\",3,21]")")" "^403$"
WHOLE=$(sfn wholeFile "[\"$TICKET\",\"src/use.ts\"]")
expect "a file reads whole, as the branch has it" "$WHOLE" '^\{"lines":\[.*\]\}$'
expect "…every line of it" "$(echo "$WHOLE" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["lines"]))')" "^[3-9]$|^[1-9][0-9]+$"
expect "…a path outside the tree is refused" "$(sfn wholeFile "[\"$TICKET\",\"../../etc/passwd\"]")" "bad request"
expect "…a file the branch does not have says so" "$(sfn wholeFile "[\"$TICKET\",\"src/nope.ts\"]")" "not in the branch"
expect "…and from another host it is refused" "$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: evil.example' "$(sfn_url wholeFile "[\"$TICKET\",\"src/use.ts\"]")")" "^403$"
expect "your clone was not touched: no worktree, nothing staged" "$(git -C "$R" worktree list | wc -l | tr -d ' ')$(git -C "$R" status --porcelain | wc -l | tr -d ' ')" "^10$"

echo "## the page is kept current: the instance says when the review changes"
EV="$OUT/events.txt"; rm -f "$EV"
curl -s -N -m 40 "$(sfn_url reviewChanges "[\"$TICKET\"]" live)" > "$EV" &
CURL=$!; disown
# each value of the live function is an event: the review's state, current first
wait_until "the stream is open, the review's state first" "^1$" grep -c "^id:" "$EV"
D3='{"title":"The export streams in","what":"the export streams in pages","userWhy":"she asked for it"}'
AMEND="{\"ticketId\":\"$TICKET\",\"decisions\":[$D3]}"
call $A "$SA" ask-review "$AMEND" > /dev/null
wait_until "revising the why moves it" "^2$" grep -c "^id:" "$EV"
BEFORE=$(grep -c "^id:" "$EV")
# the commit a reader would have viewed src/use.ts at, before the next push
VIEWED_AT=$(sfn reviewData "[\"$TICKET\"]" | python3 -c 'import json,sys; print(json.load(sys.stdin)["commit"])')
expect "the page's data names the branch's commit it was read at" "$VIEWED_AT" "^[0-9a-f]{40}$"
printf 'export const more = 1;\n' > "$R/src/more.ts"; printf '\nexport const later = 2;\n' >> "$R/src/use.ts"; git -C "$R" add -A; git -C "$R" commit -qm more
wait_until "a new commit on the branch moves it too" "^$((BEFORE + 1))$" grep -c "^id:" "$EV"
expect "…and the data now has it" "$(sfn reviewData "[\"$TICKET\"]")" "src/more.ts"
SINCE=$(sfn sinceViewed "[\"$TICKET\",\"src/use.ts\",\"$VIEWED_AT\"]")
expect "what moved in a file since it was viewed: the new line alone" "$SINCE" '"kind":"\+","text":"export const later = 2;"'
# the push added a blank line and the export: those two, and nothing it had before
expect "…and nothing it had before" "$(echo "$SINCE" | python3 -c 'import json,sys; print(sum(1 for h in json.load(sys.stdin)["hunks"] for l in h["lines"] if l["kind"] != " "))')" "^2$"
expect "…a commit that is not a hash is refused" "$(sfn sinceViewed "[\"$TICKET\",\"src/use.ts\",\"HEAD~1\"]")" "bad request"
expect "…a commit the clone does not have says the branch was rewritten" "$(sfn sinceViewed "[\"$TICKET\",\"src/use.ts\",\"0000000000000000000000000000000000000000\"]")" "branch was rewritten"
kill $CURL 2>/dev/null
# o on a review open where its tab cannot be brought forward opens one
# marked ?take, which the old tab hands over to: the marker serves the page
expect "a tab marked to take over is the same page" "$(curl -s "$ORIGIN/review/$TICKET?take")" "<title>Review by intent</title>"

echo "## PHP: Intelephense over the branch, the clone's vendor/ linked in"
# the clone's own Composer install: untracked, as vendor/ always is
mkdir -p "$R/vendor/acme/greeter/src"
printf '<?php\n\nnamespace Acme;\n\nfinal class Greeter\n{\n    /** Says hello to someone. */\n    public function hello(string $name): string\n    {\n        return "hello $name";\n    }\n}\n' > "$R/vendor/acme/greeter/src/Greeter.php"
printf 'vendor/\n' > "$R/.gitignore"
printf '{ "autoload": { "psr-4": { "App\\\\": "src/" } } }\n' > "$R/composer.json"
printf '<?php\n\nnamespace App;\n\n/** Where the rows come from. */\ninterface Rows\n{\n    /** The rows, at most this many. */\n    public function fetch(int $limit): array;\n}\n' > "$R/src/Rows.php"
printf '<?php\n\nnamespace App;\n\nuse Acme\\Greeter;\n\nfinal class Exporter\n{\n    public function __construct(private readonly Rows $rows, private readonly Greeter $greeter) {}\n\n    public function first(): string\n    {\n        $rows = $this->rows->fetch(1);\n        return $this->greeter->hello((string) strlen(implode(",", $rows[0] ?? [])));\n    }\n}\n' > "$R/src/Exporter.php"
# a function documented on its own line, and a second Composer project that
# keeps its packages somewhere else (config.vendor-dir), untracked too
printf '<?php\n\n/** Joins the row'"'"'s cells. */ function cells(array $row): string {\n    return implode(",", $row);\n}\n' > "$R/src/helpers.php"
printf '<?php\n\nnamespace App;\n\nfinal class Report\n{\n    public function line(array $row): string\n    {\n        return cells($row);\n    }\n}\n' > "$R/src/Report.php"
mkdir -p "$R/jobs/src" "$R/jobs/deps/acme/clock/src"
printf '{ "config": { "vendor-dir": "deps" } }\n' > "$R/jobs/composer.json"
printf 'deps/\n' > "$R/jobs/.gitignore"
printf '<?php\n\nnamespace Acme;\n\nfinal class Clock\n{\n    /** The time now, as text. */\n    public function now(): string\n    {\n        return date("c");\n    }\n}\n' > "$R/jobs/deps/acme/clock/src/Clock.php"
printf '<?php\n\nnamespace Jobs;\n\nuse Acme\\Clock;\n\nfinal class Stamp\n{\n    public function at(Clock $clock): string\n    {\n        return $clock->now();\n    }\n}\n' > "$R/jobs/src/Stamp.php"
git -C "$R" add -A; git -C "$R" commit -qm php
# the column a word starts at on a line of a file of the branch (0-based)
colof() { awk -v w="$3" -v n="$2" 'NR == n { print index($0, w) - 1 }' "$R/$1"; }
expect "the page can see the pinned Intelephense is there" "$(sfn toolState '["php"]')" "\"tool\":\"php\",\"language\":\"PHP\",\"name\":\"Intelephense\".*\"licence\".*\"state\":\"ready\""
H=$(sfn hoverAt "[\"$TICKET\",\"src/Exporter.php\",13,$(colof src/Exporter.php 13 fetch)]")
expect "hovering a method of the branch's own interface: its name and signature" "$H" "Rows::fetch.*public function fetch\\(int \\\$limit\\): array"
expect "hovering a Composer package's method, from the clone's vendor/" "$(sfn hoverAt "[\"$TICKET\",\"src/Exporter.php\",14,$(colof src/Exporter.php 14 hello)]")" "Greeter::hello.*public function hello\\(string \\\$name\\): string"
expect "hovering a PHP function: its signature, from PHP's own stubs" "$(sfn hoverAt "[\"$TICKET\",\"src/Exporter.php\",14,$(colof src/Exporter.php 14 strlen)]")" "function strlen\\(string \\\$string\\): int"
P=$(sfn definitionAt "[\"$TICKET\",\"src/Exporter.php\",13,$(colof src/Exporter.php 13 fetch)]")
expect "peeking it opens the interface in its own file" "$P" "\"file\":\"src/Rows.php\",\"where\":\"branch\""
expect "…its doc comment as the doc, the code from the declaration" "$P" "\"doc\":\"The rows, at most this many.\",\"code\":\"    public function fetch"
expect "peeking a package's method names the package's file" "$(sfn definitionAt "[\"$TICKET\",\"src/Exporter.php\",14,$(colof src/Exporter.php 14 hello)]")" "\"file\":\"acme/greeter/src/Greeter.php\",\"where\":\"package\""
expect "a function documented on its own line: the peek keeps its declaration, the comment as its doc" "$(sfn definitionAt "[\"$TICKET\",\"src/Report.php\",9,$(colof src/Report.php 9 cells)]")" "\"file\":\"src/helpers.php\".*\"doc\":\"Joins the row's cells.\",\"code\":\"function cells\\(array \\\$row\\): string \\{"
expect "a project with its own vendor-dir: its package hovers" "$(sfn hoverAt "[\"$TICKET\",\"jobs/src/Stamp.php\",11,$(colof jobs/src/Stamp.php 11 now)]")" "Clock::now.*public function now\\(\\): string"
expect "…and peeks as the package's file" "$(sfn definitionAt "[\"$TICKET\",\"jobs/src/Stamp.php\",11,$(colof jobs/src/Stamp.php 11 now)]")" "\"file\":\"acme/clock/src/Clock.php\",\"where\":\"package\""
expect "peeking a PHP function says it is built into PHP" "$(sfn definitionAt "[\"$TICKET\",\"src/Exporter.php\",14,$(colof src/Exporter.php 14 strlen)]")" "\"where\":\"builtin\",\"builtInto\":\"PHP\""

if [ "${KEEP:-0}" = "1" ]; then echo "KEEP: $ORIGIN/review/$TICKET"; summary; exit; fi
kill_all; summary
