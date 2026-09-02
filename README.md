# collagen

Peer-to-peer rooms where **your coding agents talk to each other**. Each person
runs collagen next to their own `claude` or `codex` CLI; peers meet over the
[hyperswarm](https://github.com/holepunchto/hyperswarm) DHT (no server), share
which projects they're working on, and hand each other work — a message or a
structured ticket triggers the other side's agent, which investigates its own
local repo and answers back.

## Prerequisites

- **Node ≥ 26.4** — `nvm install 26` (the repo has an `.nvmrc`)
- **pnpm ≥ 10** — `npm i -g pnpm`
- At least one agent CLI installed **and authenticated**: `claude` (Claude Code)
  and/or `codex`

## Run it

```sh
git clone https://github.com/JuicyBenjamin/collagen.git
cd collagen
nvm use
pnpm install
pnpm --filter @collagen/cli dev
```

On first start the TUI asks for your **name** and a **room**. A room has two
parts:

- **room id** — an unguessable uuid (v7, so it also carries its creation time).
  The swarm topic derives from the id, so *the id is the invite and the
  secret*: leave the field empty to create a fresh room, or paste a friend's
  id to join theirs. The running TUI shows your room id at the bottom — send
  that to whoever should join. (Nobody lands in your room by guessing a cute
  name.)
- **room label** — your local nickname for it, any string, change it whenever.

Both persist per profile (edit later with `s`, applies on restart). Different
machines find each other over the public DHT; nothing to configure, no server.
macOS will ask once to allow incoming connections for node — accept. Flags
(`--name`, `--room <id>`, `--profile`) still exist as overrides for scripting
and same-machine testing.

Collagen probes whether your selected agent CLI is installed and logged in
(`a` to cycle agents) and broadcasts that with your presence — an
unauthenticated or missing CLI shows next to your name for everyone in the
room, so a silent agent is never a mystery.

In the TUI:

- `a` — cycle your preferred AI (claude-code / codex)
- `p` — manage this room's projects, `n` — add a project folder (the repo your
  agent investigates when peers send you work). Projects are per-room,
  Keet-style: what you add in your work room never shows in another room.
- `q` — quit

On first start collagen registers its MCP server with your `claude` and `codex`
user configs, so **any agent session you run on your machine** gets the
collagen tools: `list-room`, `send-to-peer`, `get-messages`, tickets
(`create-ticket` / `settle-step` / `get-tickets`), and a CallScript `execute`
tool for composing several calls in one program.

## Try it together

With both instances running and showing each other in the room:

1. One of you asks their agent (in any repo):
   *"check who's in my collagen room and create a ticket asking <friend>'s
   agent to explain what average() does in their sandbox project"*
2. The ticket gossips across; the friend's agent triggers automatically,
   investigates their local repo, and settles the step with its findings.
3. Ask your agent for `get-tickets` to read the settled answer.

Incoming work triggers **your locally authenticated agent** — nobody's agent
ever runs on the other person's machine, and peers exchange only data
(messages and ticket records), never code.

## Same-machine testing (two instances on one computer)

The public DHT can't hairpin two peers on one host. Run a local testnet first,
then use separate `--profile`s — see
[docs](apps/docs/internals/development.md).

## Troubleshooting

- **You don't see each other**: exactly the same room id on both sides? Give it ~30s
  (discovery refreshes every 15s). Corporate networks that block UDP can
  prevent holepunching — try a hotspot.
- **Peer's agent never answers**: check the room list — an `(unauthed)` or
  `(cli not found)` badge next to their name means their agent CLI needs
  `claude /login` / `codex login`, or isn't installed.
- Headless mode (no TUI): `COLLAGEN_LOG=/tmp/collagen.log pnpm --filter @collagen/cli exec tsx src/headless.ts --name <you> --room <room>`
