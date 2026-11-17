#!/bin/bash
# What a person types, with no AI and nothing set up. `collagen join <invite>`
# on a machine that has never run collagen puts it in the room. `collagen
# connect-device <code>` makes a machine one of the person's devices: on a
# fresh machine it comes up as them, in their rooms; with collagen already
# running there, the running one takes the identity on.
source "$(dirname "$0")/lib.sh"
kill_all; fresh_logs; prep_profiles; testnet

# run <who> <args…> — collagen from the terminal, as <who>: headless, in the background
run() {
  local who=$1; shift
  HOME="$SHOME" COLLAGEN_DEV=1 COLLAGEN_LOG="$OUT/$who.log" node --import tsx src/headless.ts "$@" --profile "$(profile "$who")" < /dev/null >> "$OUT/$who.out" 2>> "$OUT/$who.err" &
  disown
}
count_devices() { call "$1" "$2" devices '{}' | wc -l | tr -d ' '; }

start alice
SA=$(mcp $A)
wait_until "alice's room takes invites" "st-test3\." call $A "$SA" invite-to-room '{}'

echo "## A. join: a machine that never ran collagen, an invite, and it is in the room"
rm -f "$CFG/identity-bob-$SCN.json" "$CFG/state-bob-$SCN.json"
INV=$(call $A "$SA" invite-to-room '{}' | tail -1)
expect "an invite that is not one is said so, and nothing starts" "$(HOME="$SHOME" COLLAGEN_DEV=1 node --import tsx src/headless.ts join not-an-invite --profile "$(profile bob)" 2>&1)" "invite"
run bob join "$INV"
SB=$(mcp $B)
wait_for_peer $A "$SA" "$(id -un)"
wait_until "it is in the room, let in to write" "renamed to" call $B "$SB" rename-room '{"name":"dev room joined"}'
wait_until "alice reads what it wrote" "dev room joined" call $A "$SA" list-rooms '{}'

echo "## A2. a room already listed and never let into: an invite still gets it in"
NO_INVITE=1 start carol --room st-test3
SC=$(mcp $C)
expect "it has the room, and cannot write to it" "$(call $C "$SC" rename-room '{"name":"nope"}')" "not admitted|failed"
stop carol
run carol join "$(call $A "$SA" invite-to-room '{}' | tail -1)"
SC=$(mcp $C)
wait_until "started with the invite, it is let in" "renamed to" call $C "$SC" rename-room '{"name":"dev room rejoined"}'
wait_until "alice reads what it wrote" "dev room rejoined" call $A "$SA" list-rooms '{}'
stop carol
rm -rf "$CFG"/*-carol-"$SCN"*

echo "## A3. at the door with no invite: its screen says so, and a member lets it in from their side"
NO_INVITE=1 start carol --room st-test3
SC=$(mcp $C)
wait_until "it is told it has no invite, not that it waits to be admitted" "You have no invite to this room" call $C "$SC" room-connection '{}'
wait_until "alice sees it at the door" "At the door, with no invite: carol" call $A "$SA" get-room-access '{}'
expect "alice lets it in" "$(call $A "$SA" set-room-access '{"action":"let-in","person":"carol","said":true}')" "let carol in: they were at the door"
wait_until "it is in, and writes" "renamed to" call $C "$SC" rename-room '{"name":"dev room at the door"}'
expect "nobody is at the door any more" "$(call $A "$SA" get-room-access '{}' | grep -c 'At the door')" "^0$"
stop carol
rm -rf "$CFG"/*-carol-"$SCN"*

echo "## B. connect-device on a fresh machine: it comes up as alice, in her rooms"
CODE=$(call $A "$SA" device-code '{}' | tail -1)
expect "alice's machine makes a code" "$CODE" "^devnet-device\."
run carol connect-device "$CODE"
SC=$(mcp $C)
wait_until "the new machine lists two devices" "^2$" count_devices $C "$SC"
wait_until "alice's too" "^2$" count_devices $A "$SA"
wait_until "both of alice's rooms are open on it" "work" call $C "$SC" list-rooms '{}'
expect "…the one she is in with others too" "$(call $C "$SC" list-rooms '{}')" "dev room at the door"
call $C "$SC" switch-room '{"room":"dev room at the door"}' > /dev/null
wait_until "it writes there, with no invite" "renamed to" call $C "$SC" rename-room '{"name":"dev room by code"}'
wait_until "alice reads it" "dev room by code" call $A "$SA" list-rooms '{}'
expect "to the other member it is alice: nobody new in the room" "$(call $B "$SB" list-room '{}' | grep -c 'name: ')" "^[12]$"
expect "the code let one machine in: it is used up" "$(call $B "$SB" take-identity "{\"code\":\"$CODE\"}")" "looking for the machine"
sleep 3
expect "…so a second machine stays itself" "$(count_devices $B "$SB")" "^1$"

echo "## C. connect-device with collagen already running there: the running one takes it on"
CODE2=$(call $A "$SA" device-code '{}' | tail -1)
expect "the command hands it to the collagen that is running" "$(HOME="$SHOME" COLLAGEN_DEV=1 node --import tsx src/headless.ts connect-device "$CODE2" --profile "$(profile bob)" 2>&1)" "looking for the machine"
wait_until "it becomes one of alice's devices, at once" "^3$" count_devices $B "$SB"
wait_until "…and her other room opens on it" "rooms\[2\]" call $B "$SB" list-rooms '{}'

kill_all
summary
