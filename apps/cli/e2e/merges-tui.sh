#!/bin/bash
# The merges tab: what was merged into alice's project's default branch, the
# latest first, named by its pull request — her review of pull request #6
# drawn under it, #5 (from no ticket) with nothing under it. The host is a
# stand-in (fake-gh.mjs). In the pty: `4` opens the tab, enter drops into the
# list, `o` hands #6's url to the browser opener (a stand-in on PATH), ↓
# reaches the ticket under it, enter opens its page, esc comes back to the
# merges with the cursor where it was.
source "$(dirname "$0")/lib.sh"
kill_all; fresh_logs; prep_profiles; testnet
mkdir -p "$OUT/sandbox/.git/refs/remotes/origin"
printf 'ref: refs/heads/feat/paging\n' > "$OUT/sandbox/.git/HEAD"
printf '[remote "origin"]\n\turl = git@github.com:acme/sandbox.git\n' > "$OUT/sandbox/.git/config"
printf 'ref: refs/remotes/origin/main\n' > "$OUT/sandbox/.git/refs/remotes/origin/HEAD"
GH="$OUT/gh"; mkdir -p "$GH"
start bob
PTY="$OUT/merges-tui.out"; MARKS="$OUT/merges-tui.marks"; LOG="$OUT/merges-tui.log"
rm -f "$PTY" "$MARKS" "$OUT/merges-tui.go" "$LOG" "$LOG.keys" "$OUT/opened"
mkdir -p "$OUT/bin"; for b in open xdg-open; do printf '#!/bin/sh\necho "$@" >> "%s/opened"\n' "$OUT" > "$OUT/bin/$b"; chmod +x "$OUT/bin/$b"; done
mark() { echo "$1 $(wc -c < "$PTY")" >> "$MARKS"; }
( while [ ! -f "$OUT/merges-tui.go" ]; do sleep 1; done; wait_pty "$PTY" "tickets"; sleep 1
  printf '4'; sleep 3; mark M0_tab
  printf '\r'; sleep 1; mark M1_list
  printf 'o'; sleep 2
  printf '\033[B'; sleep 1; mark M2_ticket_row
  printf '\r'; sleep 2; mark M3_ticket
  printf '\033'; sleep 2; mark M4_back; sleep 1; printf 'q' ) | \
  PATH="$OUT/bin:$PATH" COLLAGEN_GH="$E2E/fake-gh.mjs" FAKE_GH_DIR="$GH" HOME="$SHOME" COLLAGEN_DEV=1 COLLAGEN_LOG="$LOG" script -F -q "$PTY" bash -c "stty rows ${ROWS:-30} cols ${COLS:-100}; $TUI" > /dev/null 2>&1 &
SA=$(mcp $A); wait_for_peer $A "$SA" bob; admitted bob

echo "## alice's review is pull request #6"
D1='{"title":"Rows a page","what":"the list reads a page of rows at a time","userWhy":"long lists were slow","where":["src/page.ts:1"]}'
ASK="{\"title\":\"Paging the rows\",\"peers\":[],\"project\":\"sandbox\",\"base\":\"main\",\"branch\":\"feat/paging\",\"link\":\"https://github.com/acme/sandbox/pull/6\",\"summary\":\"rows come a page at a time\",\"decisions\":[$D1]}"
ASKED=$(call $A "$SA" ask-review "$ASK")
expect "the review ticket is on the log" "$ASKED" "review ticket filed"
touch "$OUT/merges-tui.go"
await_mark() { local i; for i in $(seq 1 40); do grep -q "$1" "$MARKS" 2>/dev/null && return 0; sleep 1; done; echo "  FAIL TUI never reached $1 (see $PTY)"; FAIL=$((FAIL+1)); return 1; }
await_mark M4_back; sleep 1
KEYS=$(cut -d' ' -f2 "$LOG.keys" 2>/dev/null | tr '\n' ' ')
TEXT=$(perl -pe 's/\e\[[0-9;?]*[a-zA-Z]//g' "$PTY")

echo "## the merges, the latest first, each with the tickets it came from"
expect "the host was asked what was merged into main" "$(grep -c '"base=main"' "$GH/calls.log")" "^[1-9]"
expect "the cursor reached the list" "$KEYS" "merges"
expect "enter on the ticket's line opened its page" "$KEYS" "ticket-steps"
expect "o handed the pull request to the browser" "$(cat "$OUT/opened" 2>/dev/null)" "^https://github.com/acme/sandbox/pull/6$"
HAVE_PYTE=no; python3 -c "import pyte" 2>/dev/null && HAVE_PYTE=yes
[ -n "${PYTE_PATH:-}" ] && HAVE_PYTE=yes
if [ "$HAVE_PYTE" = yes ]; then
  render() { python3 "$E2E/render.py" "$PTY" "$MARKS" "${ROWS:-30}" "${COLS:-100}" "$1"; }
  SCREEN=$(render M1_list)
  expect "the tab is in the bar" "$SCREEN" "\[4\] merges"
  expect "into the default branch" "$SCREEN" "merges into main"
  expect "the latest first, named by its pull request" "$(echo "$SCREEN" | grep -nE 'Rows a page|Fix the header' | head -1)" "Rows a page"
  expect "…its number, branch and age beside it" "$SCREEN" "Rows a page +#6 · feat/paging · "
  expect "its ticket on a line under it" "$(echo "$SCREEN" | grep -A1 'Rows a page' | tail -1)" "└ ± you +Paging the rows"
  expect "a merge from no ticket has nothing under it" "$(echo "$SCREEN" | grep -A1 'Fix the header' | tail -1 | grep -c '└')" "^0$"
  expect "↓ put the cursor on the ticket" "$(render M2_ticket_row)" "› └ ± you +Paging the rows"
  expect "esc came back to the merges, the cursor where it was" "$(render M4_back)" "› └ ± you +Paging the rows"
else
  echo "  skip  screen-level checks (no pyte: pip install pyte, or set PYTE_PATH)"
fi
kill_all; summary
