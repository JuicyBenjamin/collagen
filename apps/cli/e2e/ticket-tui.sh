#!/bin/bash
# The ticket page in a pty: bob (mock) creates a ticket; alice attaches a
# collected transcript to it (auto-approved: the TUI runs with
# COLLAGEN_AUTO_APPROVE so the attach needs no y here); in alice's TUI the
# cursor goes down the overview to the tickets list, enter opens the ticket,
# ↓ walks steps → attachments → conversation → diagnostics, enter runs
# "collect transcripts" (bob is asked; he has nothing adopted, so nothing
# comes back), then the transcripts pages, esc returns to the list. Judged
# from the key trace, the logs and the pty text.
source "$(dirname "$0")/lib.sh"
kill_all; fresh_logs; prep_profiles; testnet
start bob; sleep 3
PTY="$OUT/ticket-tui.out"; MARKS="$OUT/ticket-tui.marks"; LOG="$OUT/ticket-tui.log"
rm -f "$PTY" "$MARKS" "$OUT/ticket-tui.go" "$LOG" "$LOG.keys"
mark() { echo "$1 $(wc -c < "$PTY")" >> "$MARKS"; }
( while [ ! -f "$OUT/ticket-tui.go" ]; do sleep 1; done; sleep 2
  printf '\033'; sleep 1; printf '\033[B'; sleep 1; printf '\033[B'; sleep 1; printf '\033[B'; sleep 1; mark M0_tickets
  printf '\r'; sleep 2; mark M1_opened
  printf '\033[B'; sleep 1; mark M1a_attachments
  printf '\033[B'; sleep 1; printf '\033[B'; sleep 1; mark M2_diagnostics
  printf '\r'; sleep 3; mark M3_ran
  printf '\033[C'; sleep 1; printf '\r'; sleep 2; mark M4_transcripts
  printf '\r'; sleep 2; mark M4a_transcript
  printf '\r'; sleep 1; mark M4b_turn_open
  printf '\r'; sleep 1; mark M4c_turn_closed
  printf '\033[D'; sleep 2; mark M4d_back_to_list
  printf '\033[D'; sleep 2; mark M5_back_to_ticket
  printf '\033'; sleep 2; printf '\033[B'; sleep 1; mark M6_back; sleep 1; printf 'q' ) | \
  COLLAGEN_AUTO_APPROVE=1 COLLAGEN_DEV=1 COLLAGEN_LOG="$LOG" script -F -q "$PTY" bash -c 'stty rows ${ROWS:-45} cols 120; node --experimental-ffi --import tsx src/index.tsx --profile alice' > /dev/null 2>&1 &
sleep 12
SA=$(mcp $A); wait_for_peer $A "$SA" bob; sleep 2

echo "## bob creates a ticket (a mock: no outbox on his side)"
call $A "$SA" drive-peer '{"peer":"bob","action":"create-ticket","project":"sandbox","goal":"explain average()","steps":[{"intent":"investigate","description":"what does average() do","mine":true}]}' > /dev/null
wait_until "the ticket is on alice's log" "explain average" goals $A "$SA"
TICKET=$(call $A "$SA" get-tickets '{}' | grep -oE 'id: [0-9a-f-]{36}' | head -1 | cut -d' ' -f2)
call $A "$SA" drive-peer "{\"peer\":\"bob\",\"action\":\"send-message\",\"project\":\"sandbox\",\"intent\":\"two-cents\",\"findings\":\"average divides by length, so an empty list gives NaN — guard it first.\",\"ticketId\":\"$TICKET\"}" > /dev/null
wait_until "bob weighed in on the ticket" ",bob,sandbox,[0-9]+,two-cents" call $A "$SA" pending-threads '{}'
# a collected transcript on disk (as a peer would have handed over), so the viewer has something to show
TDIR="$HOME/.config/collagen/transcripts/ticket-${TICKET:0:8}"; mkdir -p "$TDIR"
python3 - "$TDIR/bob-deadbeefdeadbeef.codex.jsonl" <<'PY'
import json, sys
lines = [{"timestamp":f"2026-09-09T09:{1+i//60:02d}:{i%60:02d}.000Z","type":"response_item","payload":{"type":"message","role":"user" if i % 2 else "assistant","content":[{"type":"output_text","text":f"filler turn {i}"}]}} for i in range(60)] + [
  {"timestamp":"2026-09-09T10:00:00.000Z","type":"session_meta","payload":{"id":"x","originator":"codex_cli","cwd":"/work/sandbox"}},
  {"timestamp":"2026-09-09T10:00:05.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Collagen: alice asks your user to address ask-review on project sandbox. Tell your user exactly that and wait."}]}},
  {"timestamp":"2026-09-09T10:00:09.000Z","type":"response_item","payload":{"type":"function_call","name":"get-messages","arguments":"{\"threadId\":\"deadbeefdeadbeef\"}"}},
  {"timestamp":"2026-09-09T10:00:12.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"alice asks you to review the NaN fix in average() before Friday. Want me to read the details, or do you have a reply for her?"}]}},
  {"timestamp":"2026-09-09T10:00:13.000Z","type":"event_msg","payload":{"type":"token_count"}},
]
open(sys.argv[1], "w").write("\n".join(json.dumps(l) for l in lines) + "\n")
open(sys.argv[1] + ".meta.json", "w").write(json.dumps({"subject":"x","from":"bob","fromKey":"b"*64,"ai":"codex","threadId":"deadbeefdeadbeef","sessionId":"x","since":1788904890790,"entries":63,"receivedAt":1788990000000,"requestId":"q"}))
PY
ATTACH="{\"ticketId\":\"$TICKET\",\"files\":[\"$TDIR/bob-deadbeefdeadbeef.codex.jsonl\"]}"  # built here: bash 3.2 mangles \" nested in "$( )"
ATTACHED=$(call $A "$SA" attach-files "$ATTACH")
expect "alice attached the collected transcript to the ticket (a reference on the log)" "$ATTACHED" "attached 1 file"
sleep 1
touch "$OUT/ticket-tui.go"
await_mark() { local i; for i in $(seq 1 40); do grep -q "$1" "$MARKS" 2>/dev/null && return 0; sleep 1; done; echo "  FAIL TUI never reached $1 (see $PTY)"; FAIL=$((FAIL+1)); return 1; }
await_mark M6_back; sleep 3
KEYS=$(cut -d' ' -f2 "$LOG.keys" 2>/dev/null | tr '\n' ' ')
expect "↓↓↓ from the tab bar reached the tickets list" "$KEYS" "tickets"
expect "enter opened the ticket: the cursor landed on its steps" "$KEYS" "ticket-steps"
expect "↓ from the steps landed on the attachments" "$KEYS" "ticket-attachments"
expect "the attachments section shows the file as here (we hold it), readable" "$(perl -pe 's/\e\[[0-9;?]*[a-zA-Z]//g' "$PTY" | grep -cE 'here.{0,12}enter reads it')" "^[1-9]"
expect "↓↓ walked on to the diagnostics section" "$KEYS" "ticket-diagnostics"
expect "enter ran the transcripts diagnostic against the ticket (bob was asked)" "$(grep -c 'transcripts: asked 1 peer(s) about ticket-' "$LOG")" "^1$"
expect "the conversation shows bob's message in full, not a headline" "$(perl -pe 's/\e\[[0-9;?]*[a-zA-Z]//g' "$PTY" | grep -c 'guard it first')" "^[1-9]"
expect "…under its head line (intent shown; the pty stream splits coloured spans)" "$(perl -pe 's/\e\[[0-9;?]*[a-zA-Z]//g' "$PTY" | grep -cE 'bob.{0,12}you.{0,12}two-cents')" "^[1-9]"
expect "→ enter opened the transcripts page (cursor on the collected files)" "$KEYS" "transcript-files"
expect "the transcripts page listed the collected file by provenance" "$(perl -pe 's/\e\[[0-9;?]*[a-zA-Z]//g' "$PTY" | grep -c 'from bob')" "^[1-9]"
expect "…and, opened, showed its turns readable: the assistant's line" "$(perl -pe 's/\e\[[0-9;?]*[a-zA-Z]//g' "$PTY" | grep -c 'review the NaN fix')" "^[1-9]"
rm -rf "$TDIR"
expect "enter unfolded the turn under its row (the wrapped second line is on screen)" "$(perl -pe 's/\e\[[0-9;?]*[a-zA-Z]//g' "$PTY" | grep -c 'details, or do you have a reply for her')" "^[1-9]"
expect "enter on the file opened its turns (a page of its own)" "$(echo "$KEYS" | tr ' ' '\n' | sed -n '/transcript-files/,$p' | tr '\n' ' ')" "transcript-files room transcript-lines"
expect "← from the turns went back to the list of transcripts" "$(echo "$KEYS" | tr ' ' '\n' | sed -n '/transcript-lines/,$p' | grep -v room | tr '\n' ' ')" "transcript-lines transcript-lines transcript-lines transcript-files"
expect "← from the list went back to the ticket's diagnostics (not the rail)" "$(echo "$KEYS" | tr ' ' '\n' | sed -n '/transcript-lines/,$p' | tr '\n' ' ')" "ticket-diagnostics"
expect "esc again went back to the list: the next ↓ moved in the tickets section" "$(echo "$KEYS" | tr ' ' '\n' | tail -4 | tr '\n' ' ')" "tickets"
kill_all; restore_profiles; summary
