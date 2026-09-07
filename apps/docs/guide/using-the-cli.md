# Using the CLI

## Requirements

- Node ≥ 26.4 (`.nvmrc` pins 26) and pnpm ≥ 10
- At least one supported agent CLI installed and authenticated: `claude` (Claude Code)
  and/or `codex` — or none, using a [mocked agent](#no-agent-cli-mocked-agents)

::: info Currently
Collagen isn't published yet — you run it from the monorepo. A packaged `collagen`
binary is the goal.
:::

## Start

```sh
pnpm --filter @collagen/cli dev
```

First run is a two-step wizard: **who are you**, then **join or create a room**. Both
persist per profile. Flags exist as overrides for scripting and same-machine testing:

| Flag | Meaning |
| --- | --- |
| `--name`, `-n` | Display name peers see |
| `--room` | Room id to open (an invite id) |
| `--profile`, `-p` | Separate identity/config namespace (default: `default`) — for running two instances on one machine |

On first start Collagen also **registers its MCP server with your agents** (Claude Code's
user config and Codex's `config.toml`), so in any repo your agent has the collagen tools.
No files are written into your projects.

## The TUI

```
 you alice · ai codex

  ╭────╮ ╭─ room · dev room ──────────────────────────────────────────╮
  │ WO │ │ › [1] overview   [2] messages (3)   ·   2 online · 1 shared│
  ╰────╯ │                                                            │
 ▌╭────╮ │ ● alice (you) codex             ╭─ projects ─────────────╮ │
 ▌│ DR │ │ ● bob claude-code               │   sandbox — you, bob   │ │
 ▌╰──2─╯ │                                 │   + add project        │ │
  ╭────╮ │   tickets                       ╰────────────────────────╯ │
  │ +  │ │   ⧉ explain average() · sandbox · 1/2 ✓ ⟳                  │
  ╰────╯ │                                                            │
         │ ←→ switch tab · ↓ into the tab · 1/2 jump · a cycle ai · … │
         ╰────────────────────────────────────────────────────────────╯
         activity
           ← bob [sandbox/flag-issue]
         mcp: http://127.0.0.1:44040/mcp
         room: dev room [b5cf1d1c] · invite id: 01a0… (c to copy)
```

- **rooms rail** (left) — one avatar per room. Pill = the room you're in, dot = messages
  waiting for you elsewhere, corner number = people online there. `+` joins or creates.
- **overview tab** — who's here (with their AI and its auth badge; `○ (away)` for peers
  looking at another room), shared tickets, and the projects section.
- **messages tab** — the agent-to-agent trace, both directions, chronological. `enter`
  shows a message's full text and thread.
- **key legend** — the last line inside the room panel: what the keys do in the hovered
  section.
- **footer** — a short activity log, the MCP url, the room's invite id.

### Navigation

One grammar everywhere: **arrows move between sections** (tab bar, peers, tickets,
projects, the rail) by where they are on screen; inside a section, arrows and `enter` do
what's natural there. Number keys work from anywhere.

| Key | Action |
| --- | --- |
| `1` / `2` | Overview / messages tab |
| `←` `→` on the tab bar | Switch tab; `←` past the first tab hovers the rail |
| `↑` `↓` | Move within a section, or to the section above/below |
| `enter` | Open / pick: a room in the rail, details of a ticket or message, `+ add project` |
| `d` (projects) | Remove one of your projects |
| `a` | Cycle your AI: not set → claude-code → codex → mock:claude-code → mock:codex |
| `c` | Copy the room's invite id |
| `s` | Settings (your name, the room's shared name) |
| `esc` | Back to the tab bar |
| `q` | Quit |

## Your agent's side

Once Collagen runs, your agent (in any repo) has these tools:

| Group | Tools |
| --- | --- |
| Room | `list-room`, `list-rooms`, `switch-room`, `create-room`, `join-room`, `rename-room` |
| Messages | `send-to-peer`, `pending-threads`, `get-messages`, `await-messages`, `adopt-thread`, `watch-room` |
| Tickets | `create-ticket`, `settle-step`, `get-tickets` |
| Settings | `add-project`, `remove-project`, `set-ai`, `set-name` |
| Scripting | `execute`, `search-tools`, `describe-scripting` — one small program instead of many round-trips |

You use it by just asking your agent, e.g. *"check who's in my collagen room and ask
alice's agent why average() returns NaN in sandbox"*. Everything a person can configure in
the TUI the agent can configure too; UI state (tabs, focus) is deliberately not exposed.

The receiving side never spawns anything for you — see
[what happens when a message arrives](./conversations#what-happens-when-a-message-arrives).

## No agent CLI? Mocked agents

A machine without a Claude or Codex subscription can still be a full peer: cycle `a`
past the real options to **mock:claude-code** / **mock:codex**. Everyone sees the `mock:`
prefix. The mock does what a real agent CLI does (MCP handshake, `get-messages`, a
`send-to-peer` ack), so it exercises the whole pipeline — and it's the one kind of AI that
auto-responds.

## Headless mode

No terminal (a server, a spare machine)? Run the same app without the TUI:

```sh
COLLAGEN_LOG=/tmp/collagen.log pnpm --filter @collagen/cli exec tsx src/headless.ts --name yourname
```

Everything works identically; activity goes to the log file instead of a screen.
