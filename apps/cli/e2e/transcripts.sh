#!/bin/bash
# Transcripts on request: alice asks the room for the agents' conversations on
# a thread. bob has adopted that thread into a fake codex session whose rollout
# file lives in a temp CODEX_HOME. The ask does NOT answer itself — a session
# is the one thing nobody asked their own agent to send — so bob's side waits
# until his agent is told to share it; then the slice from adoption on goes to
# alice directly and is filed under ~/.config/collagen/transcripts/<subject>/.
# No CLI runs.
source "$(dirname "$0")/lib.sh"
kill_all; fresh_logs; prep_profiles; testnet
CODEX_FAKE="$OUT/codex-home"; rm -rf "$CODEX_FAKE"; mkdir -p "$CODEX_FAKE/sessions/2026/09/09"
SID="019c0000-0000-7000-8000-00000000e2e0"
CODEX_HOME="$CODEX_FAKE" start bob; start alice
SA=$(mcp $A); wait_for_peer $A "$SA" bob; SB=$(mcp $B); admitted bob

echo "## a thread exists between alice and bob"
call $A "$SA" send-to-peer '{"peer":"bob","project":"sandbox","intent":"ask","findings":"hello bob"}' > /dev/null
wait_until "bob's mock answered on the pair thread" ",bob,sandbox," call $A "$SA" pending-threads '{}'
TID=$(call $A "$SA" pending-threads '{}' | grep -oE '[0-9a-f]{16}' | head -1); echo "  thread: $TID"

echo "## bob adopted it into a codex session; its rollout has old and new lines"
ADOPT="{\"threadId\":\"$TID\",\"agent\":\"codex\",\"sessionId\":\"$SID\"}"
expect "bob adopted the thread" "$(call $B "$SB" adopt-thread "$ADOPT")" "^\"adopted: new messages on thread $TID"
cat > "$CODEX_FAKE/sessions/2026/09/09/rollout-2026-09-09T10-00-00-$SID.jsonl" <<EOF
{"timestamp":"2020-01-01T00:00:00.000Z","type":"session_meta","payload":{"id":"$SID"}}
{"timestamp":"2020-01-01T00:01:00.000Z","type":"response_item","text":"unrelated work from before the adoption"}
{"timestamp":"2030-01-01T00:00:00.000Z","type":"response_item","text":"collagen nudge arrives"}
{"timestamp":"2030-01-01T00:00:01.000Z","type":"response_item","text":"bob decides what to answer"}
EOF

echo "## alice asks the room"
SUBJECT="thread-$TID"; DEST="$CFG/transcripts/$SUBJECT"; rm -rf "$DEST"
OUT1=$(call $A "$SA" request-transcripts "{\"threadId\":\"$TID\"}")
expect "the ask went to the one peer present" "$OUT1" "asked 1 peer"
wait_until "bob's side kept the ask and answered nothing" "^1$" bash -c "grep -c 'asks for your codex conversation' '$OUT/bob.log'"
expect "…and it stays waiting: nothing is on alice's disk yet" "$(ls "$DEST" 2>/dev/null | wc -l | tr -d ' ')" "^0$"
expect "bob's agent can read the ask to him, unanswered" "$(call $B "$SB" list-transcripts '{}')" "askedOfYou"
echo "## bob says hand it over"
expect "share-transcripts sent the one that was asked for" "$(call $B "$SB" share-transcripts '{}')" "transcript sent: 2 entries"
wait_until "alice filed the slice bob handed over" "^1$" bash -c "ls '$DEST' 2>/dev/null | grep -c 'bob-$TID.codex.jsonl\$'"
FILE="$DEST/bob-$TID.codex.jsonl"
expect "the slice keeps the meta line and what came after the adoption" "$(grep -c '' "$FILE")" "^3$"
expect "…and drops what predates it" "$(grep -c 'unrelated work' "$FILE")" "^0$"
expect "list-transcripts shows it, with provenance" "$(call $A "$SA" list-transcripts '{}')" "$SUBJECT,bob,codex,2,"
expect "a sidecar records who, which agent, since when, how much" "$(python3 -c "import json;m=json.load(open('$FILE.meta.json'));print(m['from'],m['ai'],m['entries'],m['sessionId'][:8],m['since']>0,len(m['fromKey']))")" "^bob codex 2 019c0000 True 64$"
expect "bob's log records what went out" "$(grep -c 'transcript sent: 2 entries' "$OUT/bob.log")" "^1$"
expect "nothing is waiting on bob's side any more" "$(call $B "$SB" share-transcripts '{}')" "no transcript requests are waiting"
rm -rf "$DEST"
kill_all; summary
