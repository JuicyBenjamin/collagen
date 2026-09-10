#!/bin/bash
# The why, on screen. alice's agent asks bob for a review (it goes out at once — there is no approval step). In her TUI the
# cursor goes down the overview to the tickets list, enter opens the review
# ticket — a "why" section sits above the steps with the branch, the link and
# the counts — ↑ reaches it, enter opens the why in full: every decision with
# how she steered it and what her agent reasoned, then the forks with the
# file:line each produced. ← goes back to the ticket. Judged from the key
# trace and the pty text.
source "$(dirname "$0")/lib.sh"
kill_all; fresh_logs; prep_profiles; testnet
mkdir -p "$OUT/sandbox/.git"
printf 'ref: refs/heads/feat/opening-animation\n' > "$OUT/sandbox/.git/HEAD"
printf '[remote "origin"]\n\turl = git@github.com:JuicyBenjamin/collagen.git\n' > "$OUT/sandbox/.git/config"
start bob
PTY="$OUT/review-tui.out"; MARKS="$OUT/review-tui.marks"; LOG="$OUT/review-tui.log"
rm -f "$PTY" "$MARKS" "$OUT/review-tui.go" "$LOG" "$LOG.keys"
mark() { echo "$1 $(wc -c < "$PTY")" >> "$MARKS"; }
( while [ ! -f "$OUT/review-tui.go" ]; do sleep 1; done; wait_pty "$PTY" "tickets"; sleep 1
  printf '\033'; sleep 1; printf '\033[B'; sleep 1; printf '\033[B'; sleep 1; printf '\033[B'; sleep 1; mark M0_tickets
  printf '\r'; sleep 2; mark M1_opened
  printf '\033[A'; sleep 1; mark M2_why_section
  printf '\r'; sleep 2; mark M3_why_page
  printf '\033[B'; sleep 1; printf '\033[B'; sleep 1; mark M4_scrolled
  printf '\033[D'; sleep 2; mark M5_back_to_ticket; sleep 1; printf 'q' ) | \
  HOME="$SHOME" COLLAGEN_DEV=1 COLLAGEN_LOG="$LOG" script -F -q "$PTY" bash -c "stty rows ${ROWS:-45} cols 120; $TUI" > /dev/null 2>&1 &
SA=$(mcp $A); wait_for_peer $A "$SA" bob; admitted bob

echo "## alice's agent asks bob for a review, with the why"
D1='{"what":"pure frame functions for the logo","userWhy":"she said make it look cool","agentWhy":"a frame is testable without a terminal","where":["src/lib/logoFrame.ts:60"]}'
D2='{"what":"a fast boot is still held for one sweep","userWhy":"fine if it takes longer, for animation","where":["src/lib/opening.ts:14"]}'
F1='{"at":"src/components/Logo/Logo.tsx:87","chose":"setInterval at 30 fps","instead":"the Timeline animator","why":"no new dependency","by":"agent"}'
ASK="{\"peers\":[\"bob\"],\"project\":\"sandbox\",\"base\":\"main\",\"summary\":\"the logo starts centred and glides into the header\",\"decisions\":[$D1,$D2],\"forks\":[$F1]}"
ASKED=$(call $A "$SA" ask-review "$ASK")
expect "the review ticket is on the log" "$ASKED" "review ticket filed, asked of bob"
TICKET=$(echo "$ASKED" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)

echo "## bob reads it and asks for changes — a complete review, not a failure"
SB=$(mcp $B)
wait_until "bob holds the ticket" "review feat/opening-animation" goals $B "$SB"
DRIVE="{\"peer\":\"bob\",\"action\":{\"kind\":\"post-review\",\"ticketId\":\"$TICKET\",\"result\":\"the interval leaks on unmount\",\"failed\":true}}"
drive_until "bob asked for changes" "the interval leaks" $A "$SA" "$DRIVE" rows $A "$SA" "$TICKET"
sleep 1
touch "$OUT/review-tui.go"
await_mark() { local i; for i in $(seq 1 40); do grep -q "$1" "$MARKS" 2>/dev/null && return 0; sleep 1; done; echo "  FAIL TUI never reached $1 (see $PTY)"; FAIL=$((FAIL+1)); return 1; }
await_mark M5_back_to_ticket; sleep 1
KEYS=$(cut -d' ' -f2 "$LOG.keys" 2>/dev/null | tr '\n' ' ')
TEXT=$(perl -pe 's/\e\[[0-9;?]*[a-zA-Z]//g' "$PTY")
expect "↓↓↓ from the tab bar reached the tickets list" "$KEYS" "tickets"
expect "enter opened the ticket: the cursor landed on its steps" "$KEYS" "ticket-steps"
expect "↑ from the steps reached the why section" "$KEYS" "ticket-review"
expect "the ticket page says where the code is and how much why came with it" "$(echo "$TEXT" | grep -cE 'feat/opening-animation .{1,6} main')" "^[1-9]"
expect "…the counts, not the why itself" "$(echo "$TEXT" | grep -cE '2 decisions .{1,6} 1 fork')" "^[1-9]"
expect "…and the change in alice's own words" "$(echo "$TEXT" | grep -c 'glides into the header')" "^[1-9]"

echo "## the mark for a review that asks for changes"
# the screen, not the scrollback: earlier frames hold earlier states (bob's
# mock settles its step before the driven review lands), and a grep over the
# whole dump would judge the wrong moment
HAVE_PYTE=no; python3 -c "import pyte" 2>/dev/null && HAVE_PYTE=yes
[ -n "${PYTE_PATH:-}" ] && HAVE_PYTE=yes
if [ "$HAVE_PYTE" = yes ]; then
  SCREEN=$(python3 "$E2E/render.py" "$PTY" "$MARKS" "${ROWS:-45}" 120 M0_tickets)
  # which mark each person carries is unit-tested (lib/ticketSummary.test.ts);
  # what only a real screen can show is that it is a glyph, a space off the
  # name, and that the row explains its own symbols
  # a bracket expression matches BYTES, so a class of multibyte glyphs never
  # matches: say it by shape instead — name, space, one glyph
  expect "each name carries its mark a space away, never glued to it" "$SCREEN" "bob .{1,3}  you .{1,3}"
  expect "…so no name reads as one token with a tick" "$(echo "$SCREEN" | grep -cE '(bob|you)(✓|↻|✕)')" "^0$"
  expect "the legend under the list spells the symbols out, whole" "$SCREEN" "✓ no changes .{1,6} ↻ changes asked .{1,6} ✕ failed"
  expect "…and it fits its row: nothing elided in the middle" "$(echo "$SCREEN" | grep -c '\.\.\.')" "^0$"
else
  echo "  skip  screen-level glyph checks (no pyte: pip install pyte, or set PYTE_PATH)"
fi
expect "enter opened the why in full: how she steered it" "$(echo "$TEXT" | grep -c 'the user: she said make it look cool')" "^[1-9]"
expect "…what her agent reasoned" "$(echo "$TEXT" | grep -c 'the agent: a frame is testable')" "^[1-9]"
expect "…where the decision landed" "$(echo "$TEXT" | grep -c 'src/lib/logoFrame.ts:60')" "^[1-9]"
expect "…and the fork, with the road not taken" "$(echo "$TEXT" | grep -c 'instead of the Timeline animator')" "^[1-9]"
expect "…pointing at the code the choice produced" "$(echo "$TEXT" | grep -c 'f1 src/components/Logo/Logo.tsx:87')" "^[1-9]"
expect "the crumb says why" "$(echo "$TEXT" | grep -cE 'review feat/opening-animation.{0,20}why')" "^[1-9]"
expect "← went back to the ticket" "$(echo "$KEYS" | tr ' ' '\n' | tail -3 | tr '\n' ' ')" "ticket-review"
kill_all; summary
