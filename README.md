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
pnpm --filter @collagen/cli dev -- --name <yourname> --room <shared-room-name>
```

Everyone who should meet uses the **same `--room` value** — treat it as a shared
secret between you (the default room `lobby` is public: anyone running collagen
with defaults lands there). Different machines find each other over the public
DHT; nothing to configure, no server. macOS will ask once to allow incoming
connections for node — accept.

In the TUI:

- `a` — cycle your preferred AI (claude-code / codex)
- `p` — manage projects, `n` — add a project folder (this is the repo your
  agent will investigate when peers send you work)
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

- **You don't see each other**: same `--room` on both sides? Give it ~30s
  (discovery refreshes every 15s). Corporate networks that block UDP can
  prevent holepunching — try a hotspot.
- **Peer's agent never answers**: their agent CLI must be authenticated
  (`claude` needs a completed `/login`; `codex` must be logged in) and their
  preferred AI (the `a` key) must match a CLI they actually have.
- Headless mode (no TUI): `COLLAGEN_LOG=/tmp/collagen.log pnpm --filter @collagen/cli exec tsx src/headless.ts --name <you> --room <room>`
