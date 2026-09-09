#!/bin/bash
# Shared plumbing for the two/three-instance end-to-end scenarios. Source it.
#
# Every scenario runs headless instances of the cli against a local hyperdht
# testnet, drives them over their MCP servers with curl, and reads their log
# files. Profiles alice / bob / carol live in ~/.config/collagen like any
# user's; the scenarios overwrite the parts they need and restore them.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
E2E="$ROOT/e2e" # we cd to ROOT below — helper files must be reached through this, not $(dirname "$0")
OUT="${COLLAGEN_E2E_OUT:-${TMPDIR:-/tmp}/collagen-e2e}"
CFG="$HOME/.config/collagen"
mkdir -p "$OUT"
cd "$ROOT"

# The TUI needs the Node pinned in .nvmrc (OpenTUI's FFI); pick it up when nvm is around.
if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1; nvm use --silent >/dev/null 2>&1 || true; fi

# A harness-spawned instance inherits its parent's agent env and passes it
# to the agent CLIs it spawns, which then misbehave — scrub it.
for v in $(env | grep -E '^(CLAUDE|ANTHROPIC|BAGGAGE|AI_AGENT)' | cut -d= -f1); do unset "$v"; done

# The e2e testnet advertises itself in $OUT, not in ~/.config/collagen — a
# developer's own TUI restarting mid-run must not join the test DHT.
export COLLAGEN_BOOTSTRAP_FILE="$OUT/dev-bootstrap.json"

# MCP ports are derived from the profile name (services/mcpAddress.ts)
A=http://127.0.0.1:44040/mcp
B=http://127.0.0.1:42717/mcp
C=http://127.0.0.1:44409/mcp

PASS=0; FAIL=0
kill_all() { pkill -9 -f "src/headless.ts|dev-testnet.ts|src/index.tsx --profile" 2>/dev/null; sleep 1; }
stop_gracefully() { pkill -TERM -f "$1" 2>/dev/null; sleep 3; pkill -9 -f "$1" 2>/dev/null; }

testnet() { pnpm exec tsx src/dev/dev-testnet.ts < /dev/null > "$OUT/testnet.log" 2>&1 & sleep 4; }

# start <profile> [extra args...] — headless instance, log at $OUT/<profile>.log
start() {
  local who=$1; shift
  # AUTO_APPROVE: a headless peer has no person at the TUI to approve outgoing
  # messages, so the scenarios skip the gate (approval.sh turns it back on)
  COLLAGEN_AUTO_APPROVE="${COLLAGEN_AUTO_APPROVE:-1}" COLLAGEN_DEV=1 COLLAGEN_LOG="$OUT/$who.log" pnpm exec tsx src/headless.ts --profile "$who" --name "$who" "$@" < /dev/null > /dev/null 2>&1 &
}

# fresh_logs — forget every room log so a scenario starts from nothing
fresh_logs() { rm -rf "$CFG"/store-alice "$CFG"/store-bob "$CFG"/store-carol "$CFG"/identity-carol.json "$CFG"/state-carol.json; rm -f "$OUT"/*.log; }

# prep_profiles <bob-creator:0|1> — alice: no ai, creator of her rooms;
# bob: mock:codex, joiner (or a second creator to test conflicts)
prep_profiles() {
  python3 - "$CFG" "${1:-0}" <<'PY'
import json, os, sys
base, bob_creator = sys.argv[1], sys.argv[2] == "1"
a = json.load(open(f"{base}/state-alice.json")); a["preferredAi"] = None; a["threads"] = {}; a.pop("consumed", None); a.pop("outbox", None); a.pop("attachedFiles", None); json.dump(a, open(f"{base}/state-alice.json", "w"))
b = json.load(open(f"{base}/state-bob.json")); b["preferredAi"] = "mock:codex"; b["threads"] = {}; b.pop("consumed", None); b.pop("outbox", None); b.pop("attachedFiles", None); json.dump(b, open(f"{base}/state-bob.json", "w"))
for who, creator in (("alice", True), ("bob", bob_creator)):
    f = json.load(open(f"{base}/identity-{who}.json"))
    f["activeRoomId"] = "st-test3"  # every tool call targets the focused room; a TUI session may have left it elsewhere
    for r in f["rooms"]:
        r.pop("logKey", None); r["creator"] = creator
    json.dump(f, open(f"{base}/identity-{who}.json", "w"))
PY
}

restore_profiles() {
  python3 - "$CFG" <<'PY'
import json, os, sys
base = sys.argv[1]
a = json.load(open(f"{base}/state-alice.json")); a["preferredAi"] = "codex"; a.pop("threads", None); a.pop("outbox", None); json.dump(a, open(f"{base}/state-alice.json", "w"))
b = json.load(open(f"{base}/state-bob.json")); b["preferredAi"] = "claude-code"; b.pop("threads", None); b.pop("outbox", None); json.dump(b, open(f"{base}/state-bob.json", "w"))
f = json.load(open(f"{base}/identity-bob.json"))
for r in f["rooms"]: r["creator"] = False
json.dump(f, open(f"{base}/identity-bob.json", "w"))
PY
}

# mcp <url> — open an MCP session, print its id
mcp() {
  local SID
  SID=$(curl -s -D - -o /dev/null -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"e2e","version":"0"}}}' "$1" | tr -d '\r' | awk -F': ' 'tolower($1)=="mcp-session-id"{print $2}')
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

# wait_for_peer <url> <sid> <name> [tries] — until <name> is in list-room
wait_for_peer() {
  local i
  for i in $(seq 1 "${4:-30}"); do call "$1" "$2" list-room '{}' | grep -q "name: $3" && return 0; sleep 2; done
  echo "!! $3 never showed up in the room"; return 1
}

# wait_until <label> <pattern> <command...> — poll (2 s) until the command's
# output matches; counts as an expectation. Prefer this over fixed sleeps:
# a peer restarting behind a stale connection can take ~12 s to be re-accepted.
wait_until() {
  local label=$1 pattern=$2; shift 2
  local i out
  for i in $(seq 1 "${WAIT_TRIES:-30}"); do
    out=$("$@")
    if echo "$out" | grep -qE "$pattern"; then echo "  ok   $label"; PASS=$((PASS+1)); return 0; fi
    sleep 2
  done
  echo "  FAIL $label — last: $(echo "$out" | head -c 200)"; FAIL=$((FAIL+1)); return 1
}

goals() { call "$1" "$2" get-tickets '{}' | grep -o 'goal: [^\\]*' | sed 's/goal: //' | tr '\n' ' '; }

# expect <label> <text> <pattern> — assertion with a readable line
expect() {
  if echo "$2" | grep -qE "$3"; then echo "  ok   $1"; PASS=$((PASS+1)); else echo "  FAIL $1 — got: $(echo "$2" | head -c 200)"; FAIL=$((FAIL+1)); fi
}
summary() { echo "== $PASS passed, $FAIL failed"; [ "$FAIL" -eq 0 ]; }
