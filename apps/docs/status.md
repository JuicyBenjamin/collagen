# Status & roadmap

A living snapshot of what works, what's in flight, and what's next. Update this as we go —
it's the "where did we leave off" page.

_Last updated: 2026-09-07._

## Working today

- **P2P core (`packages/p2p`)** — one Hyperswarm per identity (`Swarm`), rooms as topics;
  per room an **Autobase log** with a Hyperbee view (`RoomLog`) holding messages, tickets,
  the name and membership, replicated over the same connections via Corestore. Presence
  and remote-control stay ephemeral frames on a Protomux channel. Periodic discovery
  refresh, a swarm health line, self-healing when peers are known but none connect.
- **Rooms are conversations** — a room id is an unguessable uuid that doubles as the
  invite; the room's name is shared state (last-writer-wins). You are in every room you
  joined at once and look at one; elsewhere you're `away`. Live create / join / switch /
  leave, from the TUI (rooms rail) or the agent's tools. Peers announce their protocol
  version; a mismatch is flagged next to the peer and in `list-room`.
- **Messaging** — `send-to-peer` appends to the room's log in the thread between two peers
  about one project; the recipient may be offline and reads it when back. Room-visible.
  Unread is a per-thread cursor in local state. **Nothing spawns behind your back**: a real AI is never cold-started by an
  incoming message; it waits in the inbox (`pending-threads`, `get-messages`,
  `await-messages`) or — once you `adopt-thread` — resumes *your own* conversation in
  your harness (`claude -p --resume`, `codex queue`). Verified live in both harnesses,
  cross-machine, cross-NAT.
- **Tickets (data layer)** — a shared record: goal + steps with owners, `needs`
  dependencies, status and results. On the room log, merged deterministically in `apply`,
  so they survive every restart and reach offline members. `create-ticket` / `settle-step` / `get-tickets`. A step that
  becomes actionable is delivered to its owner on the same thread messages use.
- **MCP server** — `effect/unstable/ai` `McpServer` over Streamable HTTP, per-profile
  port. Tools for the room, messages, tickets, settings (projects, ai, name, room name,
  room membership) and a CallScript `execute` engine. Auto-registered in `~/.claude.json`
  and `~/.codex/config.toml`.
- **Mocked agents** — `mock:claude-code` / `mock:codex` let an LLM-less machine be a
  full peer; `drive-peer` (dev builds only) remote-controls a mock peer for one-machine
  end-to-end tests.
- **TUI** — OpenTUI + React on `@effect/atom-react`: rooms rail, overview (peers,
  tickets, projects) and messages (a2a trace) tabs, settings, first-run wizard. Spatial
  keyboard navigation between sections. Headless entry for servers.
- **Tests** — 52 unit tests (log apply on a real Corestore, merge/thread rules, agent-run
  policy, adapters, scripting, cli plumbing) and an in-repo e2e suite: five deterministic
  two/three-instance scenarios on a local testnet (`pnpm --filter @collagen/cli e2e`)
  plus TUI, codex and Claude adopted-thread scenarios run by hand
  ([development](/internals/development#tests)).

## Known issues

- **Concurrent MCP registration** — two instances registering at once can race on
  `~/.claude.json` (a one-off `claude mcp add exited 1`). Idempotent, self-heals.
- **First write needs a member online once.** A joiner can read the room as soon as any
  member replicates the log to them, but can't append until a member appends their writer
  key — automatic, but requires one moment of overlap.
- **Every member is an indexer.** Fine for small rooms; large rooms would want a fixed
  indexer set (Autobase supports it).

## Roadmap

Rough order, not committed.

### 1. Structured messages — [spec](/guide/conversations#structured-messages)

- [ ] Message = array of intent-tagged sections (`ask / action / why / evidence /
  constraint`), each title + body — the schema forces distillation, no transcript dumping
- [ ] Progressive disclosure: `get-messages` delivers primary sections in full, secondary
  as titles; `expand-section` pulls bodies on demand
- [ ] Message kinds (`question / bug-report / feature-request / review-request / reply`)
- [ ] TUI renders sections ranked by intent, secondary folded

### 2. Persistence — [spec](/guide/tickets#sync-model)

- [x] Tickets survive a full restart (the room's Autobase log)
- [x] Store-and-forward for messages to peers that are offline (same log)
- [ ] Read receipts: the sender can't tell whether the recipient has pulled a message

### 3. Rooms lifecycle — [spec](/guide/rooms#room-lifecycle)

- [x] Leave a room (local forget; `d` in the rail, `leave-room`)
- [ ] Membership enforcement: drop connections from keys the log doesn't know; revoke a
  member (`removeWriter`). Admission to the log exists; it's automatic today.

### 4. Identity & devices — [spec](/guide/identity)

- [ ] Log out / log in via recovery phrase
- [ ] Second device (phrase first, device pairing later)

### Infrastructure

- [ ] **Tracing sink** — spans exist (`Effect.fn` / `withSpan`); wire an exporter.
- [x] **Packaging** — `@collagen/cli` on npm (`npx @collagen/cli`); release-please turns
  the conventional commits into the version bump + patch notes, GitHub Actions publishes
  through npm trusted publishing.
- [x] **In-app update** — the registry is checked 10 s after start and every 6 h; a newer
  version shows in the status line and in `list-rooms`; `u` reinstalls through the package
  manager that installed us (npm/pnpm global) and exits with code 75, which the bin shim
  turns into a relaunch. `npx` runs are told to restart; source runs are told to pull.
- [ ] **More AI adapters** — beyond `claude-code` / `codex`.

## Decisions log

- **Effect everywhere** — services + layers + typed errors + spans, for observability.
- **`@effect/atom-react`** (not effect-rx) for the React bridge.
- **`effect/unstable/ai` McpServer** (not `@modelcontextprotocol/sdk`) — one schema system.
- **pnpm + Node 26, not Bun** — the p2p stack's native bindings panic under Bun.
- **OpenTUI + React** — Solid 2 would suit the TUI better, but `@opentui/solid` pins
  Solid 1.9; revisit when it moves.
- **No cold spawns** (2026-09-03) — an incoming message never starts an agent for you.
  Inbox or adopted session; mocks are the only exception. The user works in their own
  agent session; collagen messages *that* session on their behalf.
- **Rooms are conversations** (2026-09-07) — connected to every room, present in one
  (Keet's model), instead of one process per room.
- **Tickets are step records, not a Jira board** (2026-09-07) — the CallScript-shaped
  step DAG (owner, needs, settle) replaced the planned `todo/doing/review/done` columns:
  agents need dependencies and inline results more than columns, and a review gate is
  just a final step the creator owns. Tickets have no thread of their own — steps ride
  the message threads.
- **One swarm per identity, rooms are topics** (2026-09-07) — the first multi-room
  runtime opened one Hyperswarm per room, i.e. several DHT nodes on one keypair. Relayed
  handshakes then landed on the wrong node and every connection attempt timed out until
  the 2‑minute self-heal. Now `Swarm` owns the single node and routes `{topic, frame}`
  envelopes to `Room`s; a peer in several of your rooms is one connection.
- **Dev testnet nodes are declared not firewalled** (2026-09-07) — same day, second
  cause of slow local connects: our DHT nodes auto-detected their NAT on a 3‑node
  localhost DHT and concluded `firewalled`, so hyperdht took its same-host connect path
  (client dials the LAN address directly, server waits for a holepunch) which fails on
  this machine — every attempt `r0 … connection timed out`, 40–130 s to connect when it
  connected at all. hyperdht's own testnet helper builds its nodes with
  `firewalled: false`; we now do the same when a dev bootstrap is present. Local peers
  connect in ~40 ms. The public DHT keeps detection on.
- **Rooms are Autobase logs** (2026-09-07) — messages, tickets, the room name and
  membership are entries on one Autobase per room (Hyperbee view, Corestore per profile,
  replicated over the swarm connections). Replaced full-record broadcast + in-memory
  state; a JSON snapshot was considered for an afternoon and rejected as a dead end on a
  Pear stack. Messages are room-visible (every member holds the log) — chosen over
  sealed-to-recipient; the room is the audience. Same-day finding: a PubSub inside
  `Room.make` dropped the log's existing messages because nobody had subscribed yet —
  `messages` now replays on subscribe. Second same-day finding, on the real PC2: "has a
  `nameTs`" had been taken as "created this room", but `nameTs` is also set when a name
  is *received*, so both machines bootstrapped a log and ignored each other's. Now only an
  explicit `creator` flag bootstraps, and a log nobody else is on **yields** to a populated
  one (two lonely logs: lower key wins) — the adopted log gets its own Corestore
  namespace, since reusing a writer core across bases corrupts both.
- **"broadcast", never "gossip"** — vocabulary for shared state.
