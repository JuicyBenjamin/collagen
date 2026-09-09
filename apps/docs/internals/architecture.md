# Architecture

Collagen is a pnpm + Turborepo monorepo. Two workspaces matter:

- **`packages/p2p`** — the peer-to-peer core: wire schema, the `Room` service, ticket
  merge rules, identity and topic helpers. No UI, no process spawning.
- **`apps/cli`** — the CLI: Effect services that wrap the OS (files, child processes,
  HTTP), the MCP server, the agent runner, and the OpenTUI + React TUI.

Everything runs on [Effect](https://effect.website) v4: services are `Context.Service`
classes, wired together as layers, with typed errors and scoped resource lifecycles.

## Service layer graph

```mermaid
flowchart TD
  CliArgs["CliArgs\n(profile, name, room)"]
  Identity["Identity\nseed + name + known rooms"]
  StateStore["StateStore\nLocalState: ai, per-room projects, adopted threads"]
  Inbox["Inbox\nwaiting messages, tagged by room"]
  Outbox["Outbox\nproposals waiting for the person's yes"]
  Dispatch["Dispatch\nwrites an approved Outgoing to the log"]
  Transcripts["Transcripts\nasks peers, files what they hand over"]
  Adapters["Adapters\nclaude-code · codex · mock:*"]
  AiStatus["AiStatus\nis the CLI installed + logged in"]
  AgentRunner["AgentRunner\nresume policy per thread"]
  Rooms["Rooms\nevery known room live, one focused"]
  Swarm["Swarm (p2p)\none Hyperswarm per identity"]
  Room["Room ×N (p2p)\na topic: roster · messages · tickets · meta"]
  Scripting["Scripting\nCallScript engine"]
  Mcp["Mcp\nMcpServer over HTTP"]
  Registrar["Registrar\nregisters MCP in AI configs"]

  CliArgs --> Identity --> Rooms
  StateStore --> Rooms
  Inbox --> Rooms
  Adapters --> AgentRunner
  AiStatus --> Rooms
  AgentRunner --> Rooms
  Identity --> Swarm --> Room
  Rooms --> Room
  Rooms --> Scripting --> Mcp
  Rooms --> Mcp
  Inbox --> Mcp
  Rooms --> Dispatch --> Outbox --> Mcp
  Outbox --> Transcripts --> Mcp
  StateStore --> Outbox
  StateStore --> Mcp
  Mcp --> Registrar
```

All of these are merged into a single **`AppLayer`** (`apps/cli/src/services/AppLayer.ts`),
which requires only `CliArgs`. Both entrypoints provide it:

- **`index.tsx`** — the TUI (`effect/unstable/cli` + `NodeRuntime.runMain`; needs
  `--experimental-ffi` for OpenTUI).
- **`headless.ts`** — the same app without a terminal, for dev and headless hosts.

## `Rooms`: many rooms, one focused

`Rooms` (`apps/cli/src/services/Rooms.ts`) opens a `Room` for every room in the profile,
each in its own `Scope`, and runs the per-room daemons inside it: incoming message →
inbox + agent run, actionable ticket step → delivery, drive requests (mock peers only),
shared room name → persisted. The **focused** room is a `SubscriptionRef`; the profile
each room broadcasts derives `away` from it. Tools resolve the focused room per call, and
UI atoms follow it with `watch` (a `switchMap` over focus), so switching is instant and
nothing restarts. `join` opens a room live; `summaryChanges` streams one line per room
(name, online, unread, focused) for the rail and `list-rooms`.

## The p2p core: `Swarm` and `Room`

`Swarm` (`packages/p2p/src/Swarm.ts`) is **one Hyperswarm per identity** — one DHT node
per keypair, however many rooms. A room is a **topic** on it; a peer you share several
rooms with is **one connection** carrying frames for each. (The first design ran one
swarm per room; two DHT nodes announcing the same key made relayed handshakes land on
the wrong node and connections time out for minutes — found 2026-09-07.)

- `acquireRelease` creates the swarm and destroys it when the scope closes.
- What crosses a connection is an **envelope**: `{ topic, frame }`. Five frame kinds:
  `profile` (presence), `msg` (directed message), `ticket` (a whole ticket, merged on
  receipt), `room-meta` (the shared name, last-writer-wins), `drive` (remote control of a
  mock peer). The swarm routes each envelope to the room registered for its topic.
- A room joins with `TopicHooks` — `greet(key)`, `onFrame(key, frame)`, `onPeerGone(key)`.
  When a connected peer is discovered on a topic we're in, the swarm asks that room to
  greet (idempotent; re-swept every 15 s and on hyperswarm `update`, because topics can
  arrive after the connection). Nothing is ever said to a peer about rooms it wasn't
  discovered in — an invite is a secret.
- Discovery is refreshed every 15 s per topic; a health line is logged every minute, and
  if peers are known but none are connected for two minutes the swarm is recreated (a
  hyperswarm connection attempt can hang and block rediscovery).

`Room` (`packages/p2p/src/Room.ts`) is a **scoped service** for one topic on the swarm
plus that room's log:

- Roster = peers who greeted us *in this room* (presence, ephemeral). Tickets, members,
  the name and the message trace are read from the log's view into `SubscriptionRef`s
  whenever the log changes.
- Greeting a peer sends our profile and, if we know it, the log's key (`log-info`); a
  joiner answers with `join-log` and a member appends `add-writer`.
- `messages` (the ones addressed to us) is a stream that **replays** what the log already
  holds on subscribe and then follows — a PubSub here would drop entries that arrived
  before anyone listened, which is exactly the offline-catch-up case.
- `sendTo` / `shareTicket` / `rename` append to the log; they fail typed (`NotWritable`)
  until we're admitted. `sendDrive` stays ephemeral and needs the peer present.

Every envelope is validated with `Schema` at the boundary (`EnvelopeFromJson`);
malformed ones are logged and dropped, never trusted. Unknown fields are ignored, so
peers on slightly different versions keep talking.

## The room log (Autobase)

`RoomLog` (`packages/p2p/src/RoomLog.ts`) wraps one
[Autobase](https://github.com/holepunchto/autobase) per room, in a namespace of the
identity's Corestore (`~/.config/collagen/store-<profile>`), with a
[Hyperbee](https://github.com/holepunchto/hyperbee) view (`json` values, no extension).

- **Writers**: every member. The room's creator bootstraps the base (its key is the
  `logKey` persisted in the profile and sent in greets); a joiner opens it by key and is
  admitted when a member appends `add-writer` with the joiner's local core key. Members
  are indexers too — fine at room scale.
- **Entries** (`LogOp`, Schema-validated in `apply`; bad entries skipped): `add-writer`,
  `member` (key + name, so offline peers still resolve), `ticket` (full record, merged with
  `mergeTicket`), `rename` (LWW by ts), `msg` (a `RoomMessage` with `to`).
- **View keys**: `ticket/<id>`, `member/<key>`, `meta/name`, `msg/<000…seq>` +
  `state/msgs` (the counter). `apply` reads and writes only the view — Autobase may
  reorder entries when causal forks arrive, and re-applies deterministically.
- **Replication** is Corestore's, over every swarm connection (`store.replicate(conn)`),
  multiplexed with our envelope channel by Protomux. A member who was offline gets every
  missing block from whoever is around, then `apply` catches up their view.
- **Unread** is local: `Inbox` keeps, per room and thread, the log position of the last
  message pulled (`LocalState.consumed`), so a restart re-reads the log and lands on the
  same waiting set.

### Threads

A message's `threadId` is `sha256(sortedPeerKeys | project)` — **symmetric**, so A→B and
B→A hash to the same thread. Ticket steps use the same derivation between the ticket's
creator and the step's owner (`stepThreadId`), so a ticket has no thread of its own.

### Tickets

`packages/p2p/src/ticket.ts` holds the merge rules: steps unioned by id, per-step higher
status wins, then timestamp, then a deterministic tiebreak — a join semilattice per
field, so every peer converges whatever the arrival order. `actionableSteps` decides what
a given peer should act on now.

## The MCP server

`Mcp` (`apps/cli/src/services/Mcp.ts`) builds an `effect/unstable/ai` `McpServer` served
over Streamable HTTP on a deterministic per-profile port (`portForProfile`, 41000–44999,
ephemeral fallback logged with its reason). Tools are `Schema`-typed and grouped: room,
messages, tickets, settings, scripting — see [Using the CLI](/guide/using-the-cli#your-agents-side).
Dev runs (`COLLAGEN_DEV=1`) add `drive-peer`; a production build never registers it.

Two plain HTTP routes exist for harnesses without a convenient blocking tool call:
`GET /inbox/pending` and `GET /inbox/wait?seconds=N` (long-poll, 204 on timeout).

### `Outbox`: the human gate

The three tools that write to a room's log on the agent's behalf — `send-to-peer`,
`create-ticket`, `settle-step` — do not write. Each validates its input (unknown peer or
step fails at once) and hands `Outbox.propose` a `Proposal`: room, recipient, title, and an
`Outgoing` — plain data (`packages/p2p/src/schema.ts`): a message by peer *name*, a full
ticket record, or a step settlement. Proposals live in `LocalState.outbox`, persisted by
`StateStore` like everything else there, so they wait across a restart. The TUI renders
them from the same state (overview's first section, and a count in the status line).

`approve(id)` hands the Outgoing to **`Dispatch`**, the only place the cli appends
messages, tickets or settlements for the agent: it looks up the room, resolves the peer by
name *now* (a proposal that waited overnight still finds them), applies the settlement to
the ticket as it currently is, writes the log, and returns the same text the tool used to.
`edit(id, text)` rewrites a message's findings or a step's result before that happens;
`reject(id)` drops it — the agent isn't told, the person tells it. The tool's return value
to the agent is a fixed sentence: queued for your user's approval, tell them, stop.

Bypass exists only where there is no person to ask: a `mock:*` preferred AI, or
`COLLAGEN_AUTO_APPROVE=1` (the e2e scenarios; logged as a warning at start). In that case
`propose` dispatches at once and returns Dispatch's text.

### Diagnostics: a registry, two surfaces

`apps/cli/src/diagnostics/` holds one file per diagnostic — `id`, `title`, `summary` (the
tool description), `params` (the agent's schema), `fromContext` (params from where the
person is in the TUI, or null), `run(params, ctx, deps)` returning the text both surfaces
show — and `index.ts` lists them. `Mcp.ts` builds a `Tool` per entry (prefixed
"DIAGNOSTIC, only when the user asks for it") and merges that toolkit with the room's;
the ticket page lists the entries whose `fromContext` applies and runs them with the same
deps. Adding a diagnostic touches that folder only.

### `Transcripts`: diagnostics through the same gate

`Transcripts` (`apps/cli/src/services/Transcripts.ts`) sits above `Outbox`. `request(room,
subject, threadIds)` files the requester's own adopted slices, then broadcasts a
`transcript-request` frame (ephemeral, direct). On every other machine the service turns
a request into one outbox proposal per adopted thread it has a session file for
(`Outgoing.kind = "transcript"`, `since` = the adoption time stored on `AdoptedThread`).
Approval reaches `Dispatch`, which reads the session file *now*, keeps the lines from
`since` on (`lib/transcripts.ts`: `sessionFile`, `sliceSince`), gzips them and sends a
`transcript` frame to the requester alone. The requester's `Transcripts` files it under
`~/.config/collagen/transcripts/<subject>/`. Nothing touches the room log; no agent CLI
runs — the files are read where the CLIs keep them (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`
honoured).

The receiving half of the same principle is not enforceable in code: an agent's own
reasoning can't be gated. It is carried by the nudge (`Adapters.nudgePrompt`), the ticket
step message (`Rooms`), and every tool description that touches messages — all of which
say: here is the headline, tell your user, wait; read the thread from collagen when they
ask and never invent; a question the thread can't answer is theirs (this repo, under
direction) or the peer's (draft it, into the outbox). `RelayAgent.test.ts` pins these
strings and runs the tools under a scripted `LanguageModel` that follows them.

Interop shims for strict MCP clients (Codex's `rmcp`) live here — see
[Effect patterns](./effect-patterns#mcp-interop-shims).

## `AgentRunner`: the resume policy

When a message (or a ticket step) lands, `Rooms` calls `AgentRunner.runThread`. It never
cold-starts a real AI. Per thread:

| Situation | What happens |
| --- | --- |
| no preferred AI | message stays in the inbox |
| real AI, thread not adopted | stays in the inbox (`pending-threads` / `await-messages`) |
| adopted `claude-code` session | `claude -p --resume <session>` — appends to the user's open session |
| adopted `codex` thread | `codex queue --thread <id> --message …` — delivered on its next turn |
| `mock:*` | spawns the mock agent (test dummy; acks up to 3× per thread) |

Adapters (`Adapters.ts`) encode each CLI's flags and how to parse a session id from its
output; both the adapter and the process spawner are injectable, which is how the tests
run without any real CLI. Runs are **serialized per thread** with a semaphore, and a run
re-checks the inbox before releasing so nothing is dropped.

## The TUI

OpenTUI + React on `@effect/atom-react`; the runtime is one atom every other atom derives
from. Code layout (routes / layouts / components / atoms-at-the-lowest-shared-folder) and
the `Focusable` navigation primitive are described in
[Local development](./development#ui-code-layout-appsclisrc).
