#!/bin/bash
# Attachments: files on a ticket, held by one person, fetched by another.
# alice collects bob's (mock) codex conversation on their thread, then
# attaches it — and a screenshot from her disk — to a ticket. The references
# land on the room's log (bob sees them without any file moving). bob's agent
# fetches: the bytes come from alice directly and are filed on his side, the
# transcript with the transcripts (meta says where it came from), the image
# under attachments/ with the record beside it. A fetch for an id alice never
# attached is ignored. No CLI runs.
source "$(dirname "$0")/lib.sh"
kill_all; fresh_logs; prep_profiles; testnet
CODEX_FAKE="$OUT/codex-home"; rm -rf "$CODEX_FAKE"; mkdir -p "$CODEX_FAKE/sessions/2026/09/09"
SID="019c0000-0000-7000-8000-00000000a77a"
CODEX_HOME="$CODEX_FAKE" start bob; start alice
SA=$(mcp $A); wait_for_peer $A "$SA" bob; SB=$(mcp $B); admitted bob

echo "## a thread, a codex session on bob's side, a collected transcript on alice's"
call $A "$SA" send-to-peer '{"peer":"bob","project":"sandbox","intent":"ask","findings":"hello bob"}' > /dev/null
wait_until "bob's mock answered on the pair thread" ",bob,sandbox," call $A "$SA" pending-threads '{}'
TID=$(call $A "$SA" pending-threads '{}' | grep -oE '[0-9a-f]{16}' | head -1)
call $B "$SB" adopt-thread "{\"threadId\":\"$TID\",\"agent\":\"codex\",\"sessionId\":\"$SID\"}" > /dev/null
cat > "$CODEX_FAKE/sessions/2026/09/09/rollout-2026-09-09T10-00-00-$SID.jsonl" <<EOF
{"timestamp":"2030-01-01T00:00:00.000Z","type":"session_meta","payload":{"id":"$SID"}}
{"timestamp":"2030-01-01T00:00:01.000Z","type":"response_item","text":"collagen nudge arrives"}
{"timestamp":"2030-01-01T00:00:02.000Z","type":"response_item","text":"bob decides what to answer"}
EOF
SUBJECT="thread-$TID"; TDIR="$CFG/transcripts"
call $A "$SA" request-transcripts "{\"threadId\":\"$TID\"}" > /dev/null
wait_until "bob's side kept the ask" "^1$" bash -c "grep -c 'asks for your codex conversation' '$OUT/bob.log'"
call $B "$SB" share-transcripts '{}' > /dev/null   # a session leaves only when its person says so
TFILE="$TDIR/$SUBJECT/bob-$TID.codex.jsonl"
wait_until "alice holds bob's conversation" "^1$" bash -c "ls '$TFILE' 2>/dev/null | wc -l | tr -d ' '"

echo "## a ticket, and a screenshot on alice's disk"
TICKET=$(call $A "$SA" create-ticket '{"goal":"why does the render flicker","project":"sandbox","steps":[{"id":"s1","owner":"bob","intent":"investigate","description":"look at the frame"}]}' | grep -oE 'id: [0-9a-f-]{36}' | head -1 | cut -d' ' -f2)
wait_until "bob sees the ticket" "flicker" goals $B "$SB"
SHOT="$OUT/flicker shot.png"; python3 -c "import sys; sys.stdout.buffer.write(b'\x89PNG\r\n\x1a\n' + bytes(range(256)) * 40)" > "$SHOT"

echo "## alice attaches both"
ARGS="{\"ticketId\":\"$TICKET\",\"files\":[\"$SHOT\",\"$TFILE\"],\"note\":\"the frame and bob's side of it\"}"
expect "attach-files put two references on the ticket" "$(call $A "$SA" attach-files "$ARGS")" "attached 2 file\(s\) to .{1,2}why does the render flicker"
expect "a missing path is refused before anything is proposed" "$(call $A "$SA" attach-files "{\"ticketId\":\"$TICKET\",\"files\":[\"/nope/none.png\"]}")" "^\"failed: /nope/none.png is not a file"

echo "## bob sees the references — no file has moved"
wait_until "bob's fetch-attachments lists the screenshot, from alice, with the note" "flicker_shot.png|flicker shot.png" call $B "$SB" fetch-attachments "{\"ticketId\":\"$TICKET\"}"
# two rows, two appends: wait for the second one too, or the listing below is
# read while half of it is still crossing
wait_until "…and the transcript reference lands as well" "codex" call $B "$SB" fetch-attachments "{\"ticketId\":\"$TICKET\"}"
LISTED=$(call $B "$SB" fetch-attachments "{\"ticketId\":\"$TICKET\"}")
expect "…the image by name, type and size" "$LISTED" "flicker shot.png,image/png,10,alice"
expect "…the transcript with whose conversation it is" "$LISTED" "bob.{1,6}codex.{1,6}2 entries"
expect "…the note travels with the reference" "$LISTED" "the frame and bob's side of it"

echo "## the fetch: alice is online, so the bytes come, and are filed"
BDIR="$CFG/attachments/ticket-${TICKET:0:8}"
wait_until "the screenshot landed under attachments/ticket-<id>/ with the record beside it" "^1$" bash -c "ls '$BDIR'/*-flicker_shot.png.meta.json 2>/dev/null | wc -l | tr -d ' '"
GOT=$(ls "$BDIR"/*-flicker_shot.png | head -1)
expect "the bytes are alice's, untouched" "$(cmp "$SHOT" "$GOT" && echo same)" "^same$"
expect "the record says what it is and who held it" "$(python3 -c "import json;m=json.load(open('$GOT.meta.json'));print(m['name'],m['mime'],m['holderName'],m['ticketId']==('$TICKET'),m['receivedAt']>0)")" "^flicker shot.png image/png alice True True$"
TGOT="$TDIR/ticket-${TICKET:0:8}/bob-$TID.codex.jsonl"
wait_until "the transcript landed with the transcripts, under the ticket" "^1$" bash -c "ls '$TGOT' 2>/dev/null | wc -l | tr -d ' '"
expect "…same lines alice had" "$(cmp "$TFILE" "$TGOT" && echo same)" "^same$"
expect "…its meta says it was attached: origin subject, via alice, the attachment id as request" "$(python3 -c "import json;m=json.load(open('$TGOT.meta.json'));print(m['origin'],m.get('via'),m['from'],len(m['requestId']))")" "^$SUBJECT alice bob 36$"
expect "a second fetch-attachments reports both held, with paths" "$(call $B "$SB" fetch-attachments "{\"ticketId\":\"$TICKET\"}" | grep -o ',held\b' | grep -c .)" "^2$"
# at least both files: a fetch is a request, so a poll that lands before the
# bytes arrive asks again — the count is a floor, not an equality
expect "alice's log shows bob fetching both files" "$(grep -c 'bob fetched' "$OUT/alice.log")" "^[2-9][0-9]*$"

echo "## a fetch for something alice never attached is ignored"
expect "fetch-attachments refuses an unknown id" "$(call $B "$SB" fetch-attachments "{\"ticketId\":\"$TICKET\",\"attachmentId\":\"00000000-0000-0000-0000-000000000000\"}")" "^\"failed: no attachment"
kill_all; summary
