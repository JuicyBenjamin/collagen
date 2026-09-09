#!/bin/bash
# Shared plumbing for the end-to-end scenarios. Source it from a scenario.
#
# Every scenario is an island: its own HOME (so its own ~/.config/collagen,
# ~/.codex, ~/.claude — nothing of the developer's is read or written), its
# own profiles (alice / bob / carol, suffixed with the scenario name so their
# MCP ports never clash), its own local hyperdht testnet. That is what lets
# run-all.sh run the scenarios side by side. Instances are headless (or a TUI
# in a pty), driven over their MCP servers with curl, judged by their logs.
#
# No fixed sleeps: `mcp` waits for an instance to answer, `wait_for_peer`
# for presence, `admitted` for the log admission, `wait_until` for anything.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
E2E="$ROOT/e2e" # we cd to ROOT below — helper files must be reached through this, not $(dirname "$0")
SCN="$(basename "$0" .sh)"
ROOT_OUT="${COLLAGEN_E2E_OUT:-${TMPDIR:-/tmp}/collagen-e2e}"
OUT="$ROOT_OUT/$SCN"
SHOME="$OUT/home"            # the instances' HOME
CFG="$SHOME/.config/collagen" # …and so their config dir
mkdir -p "$OUT"
cd "$ROOT"

# The TUI needs the Node pinned in .nvmrc (OpenTUI's FFI); pick it up when nvm is around.
if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1; nvm use --silent >/dev/null 2>&1 || true; fi

# A harness-spawned instance inherits its parent's agent env and passes it
# to the agent CLIs it spawns, which then misbehave — scrub it.
for v in $(env | grep -E '^(CLAUDE|ANTHROPIC|BAGGAGE|AI_AGENT)' | cut -d= -f1); do unset "$v"; done

# This scenario's testnet advertises itself here — a developer's own TUI
# restarting mid-run must not join it, and neither must another scenario's.
export COLLAGEN_BOOTSTRAP_FILE="$OUT/dev-bootstrap.json"
# Test instances register their MCP server with no agent: nothing runs codex or claude.
export COLLAGEN_REGISTER=0

# Profiles are per scenario; MCP ports derive from the profile name
# (services/mcpAddress.ts), so scenarios running side by side never collide.
profile() { echo "$1-$SCN"; }
port_of() {
  python3 -c 'import sys
h = 0
for c in sys.argv[1]: h = (h * 31 + ord(c)) & 0xffffffff
print(41000 + h % 4000)' "$1"
}
A=http://127.0.0.1:$(port_of "$(profile alice)")/mcp
B=http://127.0.0.1:$(port_of "$(profile bob)")/mcp
C=http://127.0.0.1:$(port_of "$(profile carol)")/mcp
# the TUI command for alice — pty scenarios put it behind `script -F` (needs HOME="$SHOME" in the env)
TUI="node --experimental-ffi --import tsx src/index.tsx --profile $(profile alice)"

PASS=0; FAIL=0

# Only this scenario's processes: its peers carry `--profile <who>-<scenario>`,
# its testnet `--scenario <scenario>` (an argument dev-testnet ignores).
PEERS_PAT="--profile [a-z]+-$SCN( |\$)"
kill_all() { pkill -9 -f -- "$PEERS_PAT|dev-testnet.ts --scenario $SCN\$" 2>/dev/null; sleep 0.3; }

# stop <who> — SIGTERM one peer and wait for it to go (SIGKILL after 3 s)
stop() {
  local pat="--profile $1-$SCN( |\$)" i
  pkill -TERM -f -- "$pat" 2>/dev/null
  for i in $(seq 1 15); do pgrep -f -- "$pat" > /dev/null || return 0; sleep 0.2; done
  pkill -9 -f -- "$pat" 2>/dev/null; sleep 0.2
}
# stop_all — every peer of this scenario (the testnet stays up)
stop_all() {
  local i
  pkill -TERM -f -- "$PEERS_PAT" 2>/dev/null
  for i in $(seq 1 15); do pgrep -f -- "$PEERS_PAT" > /dev/null || return 0; sleep 0.2; done
  pkill -9 -f -- "$PEERS_PAT" 2>/dev/null; sleep 0.2
}

# wait_file <path> [tries] — until the file exists (0.1 s steps)
wait_file() { local i; for i in $(seq 1 "${2:-100}"); do [ -e "$1" ] && return 0; sleep 0.1; done; echo "!! $1 never appeared"; return 1; }

# testnet — this scenario's own local DHT; returns once it advertises itself
testnet() {
  HOME="$SHOME" node --import tsx src/dev/dev-testnet.ts --scenario "$SCN" < /dev/null > "$OUT/testnet.log" 2>&1 &
  disown
  wait_file "$COLLAGEN_BOOTSTRAP_FILE" 150
}

# start <profile> [extra args...] — headless instance, log at $OUT/<profile>.log,
# anything it prints (a crash, a stray console.log) at $OUT/<profile>.out / .err.
# Returns at once; `mcp` / `wait_for_peer` wait for it to be up.
start() {
  local who=$1; shift
  # AUTO_APPROVE: a headless peer has no person at the TUI to approve outgoing
  # messages, so the scenarios skip the gate (approval.sh turns it back on)
  HOME="$SHOME" COLLAGEN_AUTO_APPROVE="${COLLAGEN_AUTO_APPROVE:-1}" COLLAGEN_DEV=1 COLLAGEN_LOG="$OUT/$who.log" \
    node --import tsx src/headless.ts --profile "$(profile "$who")" --name "$who" "$@" < /dev/null >> "$OUT/$who.out" 2>> "$OUT/$who.err" &
  disown # killed later by pattern; no "Killed: 9" job chatter in the output
}

# fresh_logs — a clean island: no room logs, no profiles, no old output
fresh_logs() { rm -rf "$OUT"; mkdir -p "$CFG" "$OUT/sandbox"; }

# prep_profiles <bob-creator:0|1> — alice: no ai, creator of her two rooms
# ("work" and "dev room" st-test3); bob: mock:codex, joiner of st-test3 (or a
# second creator, to test conflicts). carol is created on the fly by --room.
prep_profiles() {
  python3 - "$CFG" "$SCN" "$OUT/sandbox" "${1:-0}" <<'PY'
import json, secrets, sys
cfg, scn, sandbox, bob_creator = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] == "1"
def write(name, obj): json.dump(obj, open(f"{cfg}/{name}", "w"))
write(f"identity-alice-{scn}.json", {"seed": secrets.token_hex(32), "name": "alice", "activeRoomId": "st-test3",
  "rooms": [{"id": "01a05f59-9427-7498-a36c-523ab2309b4a", "name": "work", "creator": True}, {"id": "st-test3", "name": "dev room", "creator": True}]})
write(f"state-alice-{scn}.json", {"preferredAi": None, "rooms": {"st-test3": [{"id": "e2e-sandbox-0002", "name": "sandbox", "path": sandbox}]}})
write(f"identity-bob-{scn}.json", {"seed": secrets.token_hex(32), "name": "bob", "activeRoomId": "st-test3",
  "rooms": [{"id": "st-test3", "name": "dev room", "creator": bob_creator}]})
write(f"state-bob-{scn}.json", {"preferredAi": "mock:codex", "rooms": {"st-test3": [{"id": "b-sandbox", "name": "sandbox", "path": sandbox}, {"id": "b-solo", "name": "backoffice", "path": sandbox}]}})
PY
}

# mcp <url> — open an MCP session, print its id. Waits for the instance to
# come up (its boot is the only thing worth waiting for; ~50 s cap).
mcp() {
  local SID="" i
  for i in $(seq 1 200); do
    SID=$(curl -s -m 2 -D - -o /dev/null -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
      -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"e2e","version":"0"}}}' "$1" | tr -d '\r' | awk -F': ' 'tolower($1)=="mcp-session-id"{print $2}')
    [ -n "$SID" ] && break
    sleep 0.25
  done
  [ -z "$SID" ] && { echo "!! no MCP server answered at $1" >&2; return 1; }
  curl -s -o /dev/null -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -H "mcp-session-id: $SID" -H 'MCP-Protocol-Version: 2025-06-18' \
    -d '{"jsonrpc":"2.0","method":"notifications/initialized"}' "$1"
  echo "$SID"
}

# call <url> <sid> <tool> <json-args> — prints the tool's text result
call() {
  curl -s -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -H "mcp-session-id: $2" -H 'MCP-Protocol-Version: 2025-06-18' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":9,\"method\":\"tools/call\",\"params\":{\"name\":\"$3\",\"arguments\":$4}}" "$1" | python3 -c '
import sys, json
try:
    r = json.load(sys.stdin); print(r["result"]["content"][0]["text"] if "result" in r else r)
except Exception as e:
    print("<no answer>", e)'
}

# wait_for_peer <url> <sid> <name> [tries] — until <name> is in list-room (0.3 s steps)
wait_for_peer() {
  local i
  for i in $(seq 1 "${4:-150}"); do call "$1" "$2" list-room '{}' | grep -q "name: $3" && return 0; sleep 0.3; done
  echo "!! $3 never showed up in the room $(alive "$3")"; return 1
}

# alive <who> — "(alice-log alive)" or "(alice-log GONE)", for failure messages
alive() { pgrep -f -- "--profile $1-$SCN( |\$)" > /dev/null && echo "($1 alive)" || echo "($1 GONE — see $OUT/$1.out / .err)"; }
# await_log <who> <pattern> [tries] — until the peer's log matches (0.2 s steps); not an assertion
await_log() {
  local i
  for i in $(seq 1 "${3:-150}"); do grep -qE "$2" "$OUT/$1.log" 2>/dev/null && return 0; sleep 0.2; done
  echo "!! $1's log never showed: $2 $(alive "$1")"; return 1
}
# admitted <who> — the joiner can write to the room log (what a plain `sleep` used to wait for)
admitted() { await_log "$1" "admitted to the room log"; }
# await_any <pattern> [tries] — until any peer's log in this scenario matches
await_any() {
  local i
  for i in $(seq 1 "${2:-150}"); do cat "$OUT"/*.log 2>/dev/null | grep -qE "$1" && return 0; sleep 0.2; done
  echo "!! no log showed: $1"; return 1
}

# wait_until <label> <pattern> <command...> — poll (0.5 s) until the command's
# output matches; counts as an expectation. Prefer this over fixed sleeps:
# a peer restarting behind a stale connection can take ~12 s to be re-accepted.
wait_until() {
  local label=$1 pattern=$2; shift 2
  local i out
  for i in $(seq 1 "${WAIT_TRIES:-120}"); do
    out=$("$@")
    if echo "$out" | grep -qE "$pattern"; then echo "  ok   $label"; PASS=$((PASS+1)); return 0; fi
    sleep 0.5
  done
  echo "  FAIL $label — last: $(echo "$out" | head -c 200)"; FAIL=$((FAIL+1)); return 1
}

goals() { call "$1" "$2" get-tickets '{}' | grep -o 'goal: [^\\]*' | sed 's/goal: //' | tr '\n' ' '; }

# expect <label> <text> <pattern> — assertion with a readable line
expect() {
  if echo "$2" | grep -qE "$3"; then echo "  ok   $1"; PASS=$((PASS+1)); else echo "  FAIL $1 — got: $(echo "$2" | head -c 200)"; FAIL=$((FAIL+1)); fi
}
summary() { echo "== $PASS passed, $FAIL failed"; [ "$FAIL" -eq 0 ]; }
