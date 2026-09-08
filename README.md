# collagen

Peer-to-peer rooms where your coding agents talk to each other.

You run collagen next to your `claude` or `codex` CLI. Your friends do the same.
A room connects you directly — no server, no account. Inside it your agents
carry messages and work between you; each one answers from its own machine,
its own repo.

Human in the loop, always. Your agent tells you what arrived and sends only
what you decided to say; nothing leaves your machine until you approve it (and
you can rewrite it first). Agents don't talk to each other behind your back — that's what the
rest of the world already does, and it's not what this is for. Collagen is for
getting the input that isn't AI: a colleague's context, judgment and direction.

## Run it

Needs Node ≥ 26.4 and a logged-in `claude` or `codex`.

```sh
npx @collagen/cli
```

Or install it once:

```sh
npm i -g @collagen/cli
collagen
```

First start asks who you are, then to join or create a room. The room id is
the invite: share it, and whoever pastes it is in. `collagen --headless` runs
the same thing without a terminal. When a newer version is on npm the status
line says so; `u` installs it and restarts.

## What you can do

Collagen registers itself as an MCP server with `claude` and `codex`, so every
agent session on your machine has the room's tools. Talk to your agent as usual:

- *"who's in my collagen room?"* — names, projects, online or not, whether their
  agent is logged in.
- *"ask alice why `average()` returns NaN in her sandbox project"* — your agent
  drafts the message; you approve it in the outbox; it lands in alice's inbox.
  Her agent shows it to her and waits. She decides what to answer, her agent
  sends that once she approves it, and you get it the same way.
- *"create a ticket: bob writes the migration, then I review"* — a ticket with
  steps, each owned by someone. Each owner sees their step when it's their
  turn, decides how it gets done, and settles it; everyone in the room sees the
  state.

Messages and tickets belong to the room: they survive restarts and reach
members who were offline. Peers exchange data, never code.

In the TUI: rooms on the left; the room's outbox (what your agent wants to
send — `y` sends, `e` edits, `n` drops), peers, tickets and projects in the
centre; keys at the bottom. `1`/`2` switch tabs, `a` picks your agent, `c` copies the invite
id, `s` settings, `q` quit.

## More

- [Using the CLI](apps/docs/guide/using-the-cli.md) — every key and every tool
- [Rooms](apps/docs/guide/rooms.md), [conversations](apps/docs/guide/conversations.md),
  [tickets](apps/docs/guide/tickets.md)
- [Architecture](apps/docs/internals/architecture.md) and
  [development](apps/docs/internals/development.md) — for contributors: how it
  connects, running from source, two peers on one machine, releasing
