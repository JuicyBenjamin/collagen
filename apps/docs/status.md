# Status & roadmap

A living snapshot of what works, what's in flight, and what's next. Update this as we go —
it's the "where did we leave off" page.

_Last updated: 2026-09-07._

## Working today

- **P2P core (`packages/p2p`)** — Effect-based `Room` service over Hyperswarm: `Schema`
  wire frames (`profile`, `msg`, `ticket`, `room-meta`, `drive`), roster as a
  `SubscriptionRef`, messages as a `PubSub`, symmetric thread ids. Periodic discovery
  refresh, a swarm health line, and self-healing when peers are known but none connect.
- **Rooms are conversations** — a room id is an unguessable uuid that doubles as the
  invite; the room's name is shared state (last-writer-wins). You are in every room you
  joined at once and look at one; elsewhere you're `away`. Live create / join / switch,
  from the TUI (rooms rail) or the agent's tools.
- **Messaging** — `send-to-peer` lands in the thread between two peers about one
  project. **Nothing spawns behind your back**: a real AI is never cold-started by an
  incoming message; it waits in the inbox (`pending-threads`, `get-messages`,
  `await-messages`) or — once you `adopt-thread` — resumes *your own* conversation in
  your harness (`claude -p --resume`, `codex queue`). Verified live in both harnesses,
  cross-machine, cross-NAT.
- **Tickets (data layer)** — a shared record: goal + steps with owners, `needs`
  dependencies, status and results. Broadcast, merged deterministically on every peer,
  synced to late joiners. `create-ticket` / `settle-step` / `get-tickets`. A step that
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
- **Tests** — 47 unit tests (p2p merge/thread rules, agent-run policy, adapters, scripting,
  cli plumbing), plus a scripted two-instance e2e flow on a local testnet
  ([development](/internals/development)).

## Known issues

- **Discovery on the local testnet is slow after repeated restarts** (45–130 s observed
  on 2026-09-07 vs. ~15 s normally). Real network unaffected so far; watch it.
- **Concurrent MCP registration** — two instances registering at once can race on
  `~/.claude.json` (a one-off `claude mcp add exited 1`). Idempotent, self-heals.
- **Tickets and messages live in memory.** A late joiner receives every ticket from the
  peers present; if *everyone* restarts, the tickets are gone. See roadmap.

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

- [ ] Tickets survive a full restart (per-room log on disk, merged with the room's copy
  on reconnect — the merge rules already converge)
- [ ] Store-and-forward for messages to peers that are offline
- [ ] Delivery acks / retries (at-most-once today)

### 3. Rooms lifecycle — [spec](/guide/rooms#room-lifecycle)

- [ ] Leave a room (local forget)
- [ ] Membership enforcement: today anyone holding the id connects; a keypair-backed room
  with invite codes would let members drop unknown keys

### 4. Identity & devices — [spec](/guide/identity)

- [ ] Log out / log in via recovery phrase
- [ ] Second device (phrase first, device pairing later)

### Infrastructure

- [ ] **Tracing sink** — spans exist (`Effect.fn` / `withSpan`); wire an exporter.
- [ ] **Packaging** — a `collagen` binary instead of running from the monorepo.
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
- **"broadcast", never "gossip"** — vocabulary for shared state.
