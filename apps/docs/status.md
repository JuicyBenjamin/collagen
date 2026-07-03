# Status & roadmap

A living snapshot of what works, what's in flight, and what's next. Update this as we go —
it's the "where did we leave off" page.

_Last updated: 2026-07-04._

## Working today

- **P2P core (`packages/p2p`)** — rewritten on Effect: `Schema` wire frames, tagged
  errors, scoped `Room` service (roster as `SubscriptionRef`, messages as `PubSub`),
  symmetric thread ids.
- **MCP server** — `@effect/ai` `McpServer` over Streamable HTTP, per-profile port. Tools
  `list-room`, `send-to-peer`, `get-messages`. Interop shims in place for strict clients
  (Codex `rmcp`).
- **Agent spawning** — `AgentRunner` runs the recipient's AI headless via
  `@effect/platform` `Command`; adapters for `claude-code` and `codex`; per-thread
  serialization + session resume.
- **Registration** — MCP server auto-registered in `~/.claude.json` and
  `~/.codex/config.toml` (with `default_tools_approval_mode = "approve"` for Codex).
- **TUI** — Ink UI on `@effect-atom/atom-react`; roster, projects, AI cycling, activity
  log, folder picker. Headless-safe.
- **Verified end-to-end, both agents, both directions** (2026-07-04) — a full
  bidirectional conversation: Claude Code read the thread, diagnosed the planted bug and
  replied via `send-to-peer`; Codex picked the reply up on the same thread and confirmed
  the finding. Three strict-client interop fixes landed on the way (singleton JSON-RPC
  batches, 202 for notifications, object-rooted `structuredContent`).

## Known issues

- **Concurrent MCP registration race** — two instances registering at the same time can
  hit a one-off `claude mcp add exited 1`. Idempotent, self-heals; worth a retry/serialize.
- **Dev sandbox project path** — the e2e "sandbox" project pointed into a temp dir; use a
  stable path when testing.

## Roadmap

Rough order, not committed. The three feature clusters have fleshed-out product specs on
their pages.

### 1. Rooms lifecycle — [spec](/guide/rooms#room-lifecycle)

- [ ] Create named rooms (room = its own keypair, name is a label)
- [ ] Invite peers via single/multi-use codes (Pear pairing primitives); membership
  enforced at connection time
- [ ] Leave a room (local forget; rejoin needs a fresh invite)
- [ ] TUI: room list, switch, create, invite, leave

### 2. Tickets — [spec](/guide/tickets)

- [ ] Per-room board in the TUI; statuses `todo / doing / review / done / blocked /
  wont-do`
- [ ] Ticket ↔ thread linkage (a ticket owns its agent conversation)
- [ ] MCP tools: `list-tickets`, `create-ticket`, `update-ticket` — agents pick up and
  close their own work
- [ ] Agent-close guardrail: agents move tickets to `review` by default, `done` needs a
  human (configurable per room)
- [ ] Replicated ticket log (append-only cores / Autobase) — same machinery as offline
  messaging, lands together

### 3. Structured messages — [spec](/guide/conversations#structured-messages)

- [ ] Message = array of intent-tagged sections (`ask / action / why / evidence /
  constraint`), each title + body — the schema forces distillation, no transcript
  dumping
- [ ] Progressive disclosure: `get-messages` delivers primary sections in full,
  secondary as titles; `expand-section` tool pulls bodies on demand
- [ ] TUI renders sections ranked by intent, secondary folded

### 4. Identity & devices — [spec](/guide/identity)

- [ ] Log out (forget seed locally, leave rooms, stop announcing)
- [ ] Log in as the same user via recovery phrase (mnemonic-encoded seed)
- [ ] Second device: phrase-based first, then Keet-style device pairing (identity key
  signs device keys; per-device revocation)

### Infrastructure

- [ ] **Offline / store-and-forward messaging** — live-only today; shares its sync
  machinery with the ticket log.
- [ ] **Delivery acks / retries** — currently at-most-once at the Collagen layer.
- [ ] **Harden registration** — serialize concurrent writes to `~/.claude.json`.
- [ ] **More AI adapters** — beyond `claude-code` / `codex`.
- [ ] **Tracing sink** — spans exist (`Effect.fn` / `withSpan`); wire an exporter for real
  observability.
- [ ] **Tests** — none yet; p2p + inbox + thread serialization logic first.
- [ ] **Packaging** — a `collagen` binary instead of running from the monorepo.

## Decisions log

- **Effect everywhere** — for observability/debuggability; services + layers + typed
  errors + spans.
- **effect-atom (not effect-rx)** — the maintained successor for the React/Ink bridge.
- **`@effect/ai` McpServer (not `@modelcontextprotocol/sdk`)** — one schema system, native
  Effect; the SDK + zod were dropped.
- **VitePress for docs** — lightest option with trivial Mermaid support.
- **In-place on `main`** — the rewrite landed as a sequence of commits on `main`, not a
  branch.
