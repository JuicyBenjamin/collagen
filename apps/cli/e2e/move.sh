#!/bin/bash
# A room from before rooms were encrypted moves to an encrypted log on its
# own: alice and bob share a plain room (made the old way), then both restart
# on this build. Each may start moving it; the first move on the old log
# stands and the other follows it, so both end in one encrypted room. Nothing
# is lost, nobody needs an invite, and the room's id lets no one in afterwards.
source "$(dirname "$0")/lib.sh"

# same_log — "same encrypted" once alice and bob keep one log key for the room, with its encryption key
same_log() {
  python3 - "$CFG" "$SCN" <<'PY'
import json, sys
cfg, scn = sys.argv[1], sys.argv[2]
entries = [next((room for room in json.load(open(f"{cfg}/identity-{who}-{scn}.json")).get("rooms", []) if room["id"] == "st-test3"), {}) for who in ("alice", "bob")]
keys = {entry.get("logKey") for entry in entries}
print("same" + (" encrypted" if all(entry.get("encryptionKey") for entry in entries) else "") if len(keys) == 1 and None not in keys else f"apart {keys}")
PY
}
kill_all; fresh_logs; prep_profiles; testnet

echo "## A. the room the old way: a plain log, bob let in by the room's id"
COLLAGEN_E2E_PLAIN_ROOMS=1 NO_INVITE=1 start alice
COLLAGEN_E2E_PLAIN_ROOMS=1 NO_INVITE=1 start bob
SA=$(mcp $A); SB=$(mcp $B); wait_for_peer $A "$SA" bob; admitted bob
expect "alice's log is plain" "$(cat "$OUT/alice.log")" "room log created: [0-9a-f]+… writable=true$"
call $A "$SA" create-ticket '{"title":"before the move","goal":"before the move","project":"sandbox","steps":[{"id":"s1","owner":"bob","intent":"note","description":"carried over"}]}' > /dev/null
wait_until "bob sees the ticket" "before the move" goals $B "$SB"
call $B "$SB" send-to-peer '{"peer":"alice","project":"sandbox","intent":"hello","findings":"said before the move"}' > /dev/null
stop_all

echo "## B. both on this build: the room moves, bob follows"
start alice; NO_INVITE=1 start bob
SA=$(mcp $A); SB=$(mcp $B)
await_any "moved the room to its encrypted log"
wait_until "both on one encrypted log" "same" same_log
wait_until "alice still has the ticket" "before the move" goals $A "$SA"
wait_until "bob has it on the new log" "before the move" goals $B "$SB"
wait_until "alice still has bob's message" "sandbox" call $A "$SA" pending-threads '{}'
J='{"title":"after the move","goal":"after the move","project":"sandbox","steps":[{"id":"s1","owner":"bob","intent":"note","description":"new"}]}'
call $A "$SA" create-ticket "$J" > /dev/null
wait_until "a ticket made after the move reaches bob" "after the move" goals $B "$SB"
expect "both keep the new log's key and the key that reads it" "$(same_log)" "same encrypted"

echo "## C. the room's id no longer lets anyone in"
expect "joining with the bare room id is refused" "$(call $B "$SB" join-room '{"invite":"devnet-st-test3"}')" "^failed"

kill_all; summary
