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

Working on collagen itself? `pnpm --filter @collagen/cli dev` runs it from source, on
[devnet](/internals/development#mainnet-and-devnet) — separate config dir, separate swarm
topic, separate MCP server — so it never touches the rooms the installed app is in.

First run is a two-step wizard: **who are you**, then **join or create a room**. Both
persist per profile. Flags exist as overrides for scripting and same-machine testing:

| Flag | Meaning |
| --- | --- |
| `--name`, `-n` | Display name peers see |
| `--room` | Room id to open (being let in still takes an invite: `join-room`) |
| `--profile`, `-p` | Separate identity/config namespace (default: `default`) — for running two instances on one machine |

On first start Collagen also **registers its MCP server with your agents** (Claude Code's
user config and Codex's `config.toml`), so in any repo your agent has the collagen tools.
No files are written into your projects.

## The TUI

```
 you alice · ai codex

  ╭────╮ ╭─ room · dev room ──────────────────────────────────────────╮
  │ WO │ │ › [1] overview   [2] projects   …   [5] outbox  ·  2 online  │
  ╰────╯ │                                                            │
 ▌╭────╮ │   ● you, bob                                               │
 ▌│ DR │ │   ○ carol                                                  │
 ▌╰──2─╯ │                                                            │
  ╭────╮ │   tickets                                                  │
  │ +  │ │   ⧉ explain average() · sandbox · 1/2 ✓ ⟳                  │
  ╰────╯ │                                                            │
         │ ←→ switch tab · ↓ into the tab · 1/2 jump · a cycle ai · … │
         ╰────────────────────────────────────────────────────────────╯
         activity
           ← bob [sandbox/flag-issue]
         mcp: http://127.0.0.1:44040/mcp
         room: dev room [b5cf1d1c] · c copies an invite
```

- **rooms rail** (left) — one avatar per room. Pill = the room you're in, dot = messages
  waiting for you elsewhere, corner number = people online there. `+` joins or creates.
- **overview tab** — who's in the room, in two lines that never grow: `●` who is here now,
  `○` the rest (away in another room, or offline), each ending in `…` when it is full; a
  name in the warning colour has a problem (its AI's CLI, its sign-in, another collagen
  version). `enter` there opens **people**: tabs `all` / `online` / `offline` over one row
  per person with their AI, `away`, the problem and how many projects they share here.
  Then every ticket in the room its author has not closed — whoever
  made it and whoever it is for; a closed one has left the list and stays on the log. A ticket row says whose
  it is by the colour of its kind (bright for yours, dim for somebody else's) and lists
  the *other* people on it with what each did: `✓` asked for no changes, `↻` asked for
  changes, `✕` a step failed, `…` said something, a bare name means nothing from them
  yet. So `bob ✓  carol ✓  dave ↻` is two readers happy and one asking for changes. You
  are never in that list: whether a row wants you is said by its place and its colour.
- **projects tab** — each project in the room once, with who shares it. `enter` on a dim
  `not here yet` row points collagen at your copy; `+ add project` adds a folder; `d`
  removes one of yours. `shift ↑↓` moves a project up or down: every list of projects you
  see follows that order. It is kept on your machine and never shared with the room; a
  project added later comes last.
- **merges tab** — one of your projects at a time, under a row of tabs naming them in
  your order: the first one's when you come to the tab, `←→` on that row for another's,
  each read when its tab is opened. What was merged into its default branch, the
  latest first, each by its pull request's title with its number, branch and age.
  Under a merge, the review tickets it came from (by the pull request its link names,
  else its branch, else a commit it was read at), and what each grew from above it: a
  proposal, its plan, a task — the whole chain; none when it came from none.
  More are read as you scroll down. `enter` on a ticket's line opens it (`esc` comes
  back here). `o` opens collagen's own page in your browser: on a ticket, its review
  page; on a merge, the project's merges page at that merge, with what was decided on it
  and why; anywhere else on the tab, the merges page of the project whose tab is open.
  Each project has its own merges page, at an address of its own, with tabs for the
  room's other projects. `p` opens the merge's pull request, `r` refreshes.
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
  section. On the tickets list it also spells out the verdicts (`✓` no changes, `↻`
  changes asked, `✕` failed), and `?` the rest.
- **footer** — a short activity log, the MCP url, the room, and `c` for an invite.

### Navigation

One grammar everywhere: **arrows move between sections** (tab bar, peers, tickets,
the rail) by where they are on screen; inside a section, arrows and `enter` do
what's natural there. Number keys work from anywhere.

| Key | Action |
| --- | --- |
| `1` – `5` | Overview / projects / merges / messages / outbox tab |
| `←` `→` on the tab bar | Switch tab; `←` past the first tab hovers the rail |
| `↑` `↓` | Move within a section, or to the section above/below |
| `enter` | Open / pick: a room in the rail, a ticket's page, a message's full text, `+ add project` |
| `enter` on a ticket | Open it: steps, the conversation on its threads, diagnostics (`enter` runs one; `esc` back to the list) — on an [epic](./tickets#epics-a-folder-of-work), its aim and every ticket in it |
| `space` on an epic | Fold its tickets away on the overview, or show them again (they show by default) |
| `d` | Projects: remove one of yours · rail: leave the room under the cursor |
| `r` | Rail: rename the room under the cursor; everyone in it sees the new name (your agent: `rename-room`) |
| `A` | The audit page in your browser: tool calls, tokens per call over time and the tools whose calls are growing, harnesses and models, collagen's own jobs, compactions, the room's tickets and steering. Your agent opens it with `open-audit`. |
| `c` | Copy a new invite to the room: it lets one person in, within a week (your agent: `invite-to-room`) |
| `s` | Settings, in three tabs (`↑` onto them, then `←` `→`; `1` – `3` or a click from anywhere), **General** (the level every row not set follows, and the page's switches), then by who acts in your name: **AI** (your AI, which collagen starts, wakes and hands work to) and **Tools** (what collagen does itself with no AI: the repo host). Each [steering](./conversations#steering-how-much-your-agent-does-on-its-own) row has two columns, everywhere and this room (`←` `→`); `space` changes the one under the cursor |
| `i` | You: your name, your key, and the AI the rooms see you use |
| `u` | Install the newer collagen the status line announces, then restart into it |
| `esc` | Back to the tab bar |
| `q` | Quit |

### Switches

The settings page (`s`) holds your switches too, each on or off under the tab it belongs to,
applied the moment you flip one. Your agent can list and set them for you too (`set-settings`) — say you find one
in the way.

| Switch | Default | What it does |
| --- | --- | --- |
| Open the review page when a review starts | on | When your agent starts reading a review it was asked for (its first `review-context`), the review's page opens in your browser — once per run, and not on your own reviews. Off: it opens when you press `o` or ask your agent. |
| Run an investigation's goals all at once | off | An investigation that sets no pace of its own queues all its runs together, as many running as your job limit allows. Off: one by one, each run starting when the last is done and building on what it found. |
| A reading progress bar on the review page | on | A thin bar atop the review page fills as you scroll through it. Off: no bar. |

## Your agent's side

Once Collagen runs, your agent (in any repo) has these tools:

| Group | Tools |
| --- | --- |
| Room | `list-room`, `list-rooms`, `switch-room`, `create-room`, `join-room`, `leave-room`, `rename-room` |
| Messages | `send-to-peer`, `pending-threads`, `get-messages`, `await-messages`, `adopt-thread`, `watch-ticket` — this conversation hears when a ticket moves, `watch-room` |
| Tickets | `create-ticket`, `settle-step`, `take-step` — a task step nobody has, made your user's; `get-tickets` and `get-ticket`, `ask-review` — a review with the why behind the change; `assume-review` — a review of someone else's pull request, its why inferred and marked as guesses; `claim-review` — the code's author answers those guesses and makes the review theirs; `open-review` — a review's page in your browser, as `o` does; `review-progress` — which of a review's files your user has viewed, and marking them viewed for them; `open-investigation` — an investigation's page, as `o` does on one; `open-merges` — a project's merges page in your browser; `epic` — folders of tickets, shaped by anyone, only when asked |
| Diagnostics | `request-transcripts`, `list-transcripts` — the agents' conversations around a ticket, each handed over by its person; `attach-files`, `fetch-attachments` — files on a ticket, held by their owner, fetched on request; `review-context` — the why behind a review ticket, read when your person asks; `token-cost` — what collagen costs your AI in tokens, read from its own session logs ([how](../internals/token-cost)) |
| Settings | `add-project`, `remove-project`, `order-projects` — the order you keep the projects in, listed or set, on your machine only; `set-steering` — how far collagen and your agent go in your name, the master and each kind, yours and other people's, everywhere or in this room; `set-jobs` — how many jobs run at once, and each job's harness and model; `set-name`, `set-settings` — your switches, listed or set; `set-merging` — whether collagen merges your reviewed pull requests for you, and `merge-review` — your yes to one, when your repo-host steering is ask first; `themes`, `set-theme`, `add-theme`, `edit-theme`, `remove-theme` — the theme every page wears (a review, the merges): listed, put on, added from a daisyUI theme generator link, edited (renamed, a colour at a time) or removed |
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
