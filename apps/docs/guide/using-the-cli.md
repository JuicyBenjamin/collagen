# Using the CLI

## Requirements

- Node ≥ 26.4 (`.nvmrc` pins 26) and pnpm ≥ 10
- At least one supported agent CLI installed and authenticated: `claude` (Claude Code)
  and/or `codex`

## Start

```sh
npx @collagen/cli          # run it
npm i -g @collagen/cli     # or install once, then: collagen
```

Working on collagen itself? `pnpm --filter @collagen/cli dev` runs it from source — see
[local development](/internals/development).

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
  looking at another room), every ticket in the room — whoever made it and whoever it is
  for, finished ones dim at the end — and the projects section. A ticket row says whose
  it is by the colour of its kind (bright for yours, dim for somebody else's) and lists
  the *other* people on it with what each did: `✓` asked for no changes, `↻` asked for
  changes, `✕` a step failed, `…` said something, a bare name means nothing from them
  yet. So `bob ✓  carol ✓  dave ↻` is two readers happy and one asking for changes. You
  are never in that list: whether a row wants you is said by its place and its colour.
- **messages tab** — the agent-to-agent trace, both directions, chronological. `enter`
  shows a message's full text and thread.
- **outbox tab** — everything of yours that has gone out, in one list, newest first,
  from every room you are in. A row is what it was, which project (`sandbox/`), who it
  was for when it was for a person, and what it was about; `enter` unfolds the text it
  carried in full (`↑↓` scroll it, `pgup`/`pgdn`, `home`/`end`, `←` back to the list).
  There is nothing to approve here: your agent acts on your word, and this is the
  receipt. Neither this tab nor **messages** carries a count: both are logs that only
  grow, so their size is not something a person acts on.
- **key legend** — the last line inside the room panel: what the keys do in the hovered
  section.
- **footer** — a short activity log, the MCP url, the room's invite id.

### Navigation

One grammar everywhere: **arrows move between sections** (tab bar, peers, tickets,
projects, the rail) by where they are on screen; inside a section, arrows and `enter` do
what's natural there. Number keys work from anywhere.

| Key | Action |
| --- | --- |
| `1` / `2` / `3` | Overview / messages / outbox tab |
| `←` `→` on the tab bar | Switch tab; `←` past the first tab hovers the rail |
| `↑` `↓` | Move within a section, or to the section above/below |
| `enter` | Open / pick: a room in the rail, a ticket's page, a message's full text, `+ add project` |
| `enter` on a ticket | Open it: steps, the conversation on its threads, diagnostics (`enter` runs one; `esc` back to the list) |
| `d` | Projects: remove one of yours · rail: leave the room under the cursor |
| `a` | Cycle your AI: not set → claude-code → codex → mock:claude-code → mock:codex |
| `c` | Copy the room's invite id |
| `s` | Settings (your name, the room's shared name) |
| `u` | Install the newer collagen the status line announces, then restart into it |
| `esc` | Back to the tab bar |
| `q` | Quit |

## Your agent's side

Once Collagen runs, your agent (in any repo) has these tools:

| Group | Tools |
| --- | --- |
| Room | `list-room`, `list-rooms`, `switch-room`, `create-room`, `join-room`, `leave-room`, `rename-room` |
| Messages | `send-to-peer`, `pending-threads`, `get-messages`, `await-messages`, `adopt-thread`, `watch-room` |
| Tickets | `create-ticket`, `settle-step`, `get-tickets`, `ask-review` — a review with the why behind the change |
| Diagnostics | `request-transcripts`, `list-transcripts` — the agents' conversations around a ticket, each handed over by its person; `attach-files`, `fetch-attachments` — files on a ticket, held by their owner, fetched on request; `review-context` — the why behind a review ticket, read when your person asks |
| Settings | `add-project`, `remove-project`, `set-ai`, `set-name` |
| Scripting | `execute`, `search-tools`, `describe-scripting` — one small program instead of many round-trips |

You use it by just asking your agent, e.g. *"check who's in my collagen room and ask
alice why average() returns NaN in sandbox"*. Everything a person can configure in the TUI
the agent can configure too; UI state (tabs, focus) is deliberately not exposed.

Two rules hold on every machine. Nothing goes out on an agent's own initiative:
`send-to-peer`, `create-ticket` and `settle-step` are things your agent does because you
said so, and the **outbox** tab is the record of every one of them. And nothing answers
for you: what arrives is shown to you by your agent, which waits for your direction — see
[what happens when a message arrives](./conversations#what-happens-when-a-message-arrives).

## Headless mode

The same app without the TUI, for tests and for a machine that only receives:

```sh
COLLAGEN_LOG=/tmp/collagen.log collagen --headless --name yourname
```

Activity goes to the log file instead of a screen; sends work the same way they do in the
TUI. What it cannot do is stand in for a person: a transcript a peer asks for still waits
for someone to say `share-transcripts`, and nothing relays itself. (From source:
`pnpm --filter @collagen/cli exec tsx src/headless.ts …`.)
