# Status & roadmap

A living snapshot of what works, what's in flight, and what's next. Update this as we go —
it's the "where did we leave off" page.

_Last updated: 2026-07-03._

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
- **Verified end-to-end** — a full round trip (Bob → Alice → reply) with the **Codex**
  path: message delivered, agent auto-spawned, read via `get-messages`, diagnosed the
  planted bug, replied on the same thread.

## Known issues

- **Claude CLI headless auth** — on the current dev machine `claude -p` returns `401` even
  standalone, which blocks the `claude-code` spawn path. Needs a CLI re-auth; not a
  Collagen bug.
- **Concurrent MCP registration race** — two instances registering at the same time can
  hit a one-off `claude mcp add exited 1`. Idempotent, self-heals; worth a retry/serialize.
- **Dev sandbox project path** — the e2e "sandbox" project pointed into a temp dir; use a
  stable path when testing.

## Roadmap

Rough order, not committed:

- [ ] **Offline / store-and-forward messaging** — today delivery is live-only; queue
  messages for disconnected peers.
- [ ] **Delivery acks / retries** — currently at-most-once at the Collagen layer.
- [ ] **Harden registration** — serialize concurrent writes to `~/.claude.json`.
- [ ] **More AI adapters** — beyond `claude-code` / `codex`.
- [ ] **Multiple rooms** — the model supports per-room project enables; the UI is
  single-room (`lobby`).
- [ ] **Tracing sink** — spans exist (`Effect.fn` / `withSpan`); wire an exporter for real
  observability.
- [ ] **Tests** — no automated tests yet; the p2p + inbox + thread logic is the priority.

## Decisions log

- **Effect everywhere** — for observability/debuggability; services + layers + typed
  errors + spans.
- **effect-atom (not effect-rx)** — the maintained successor for the React/Ink bridge.
- **`@effect/ai` McpServer (not `@modelcontextprotocol/sdk`)** — one schema system, native
  Effect; the SDK + zod were dropped.
- **VitePress for docs** — lightest option with trivial Mermaid support.
- **In-place on `main`** — the rewrite landed as a sequence of commits on `main`, not a
  branch.
