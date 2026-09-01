# Using the CLI

## Requirements

- Node ≥ 26.4 (`.nvmrc` pins 26) and pnpm ≥ 10
- At least one supported agent CLI installed and authenticated: `claude` (Claude Code)
  and/or `codex`

::: info Currently
Collagen isn't published yet — you run it from the monorepo. A packaged `collagen`
binary is the goal.
:::

## Start

```sh
pnpm --filter @collagen/cli dev -- --name yourname
```

Flags:

| Flag | Meaning |
| --- | --- |
| `--name`, `-n` | Display name peers see (persisted after first use) |
| `--profile`, `-p` | Separate identity/config namespace (default: `default`) — mainly for running two instances on one machine |

On first start Collagen also **registers itself with your agents** (Claude Code's user
config and Codex's `config.toml`), so in any repo your agent has the collagen tools
available. No files are written into your projects.

## The TUI

```
◇ collagen  peer-to-peer
you benjamin · ai claude-code

╭ room · lobby ─────────────────────────────╮
│ 2 online                                  │
│ ● benjamin (you)  claude-code  backoffice │
│ ● alice           codex        backoffice │
│                                           │
│ messages                                  │
│ ← alice [backoffice/reply] Diagnosis: …   │
╰───────────────────────────────────────────╯
╭ you ──────────────────────────────────────╮
│ preferred ai: claude-code                 │
│ projects in room: ◆ backoffice            │
╰───────────────────────────────────────────╯
activity
  start codex · alice/backoffice
  agent done: Sent the diagnosis…
mcp: http://127.0.0.1:41234/mcp
a cycle ai · p projects · q quit
```

- **room panel** — who's online, their AI, their shared projects (highlighted when you
  share the same one), and the latest messages.
- **you panel** — your preferred AI and the projects you're sharing.
- **activity** — what Collagen is doing on your behalf: agents starting, finishing,
  registration, errors.

### Keys

| Key | Action |
| --- | --- |
| `a` | Cycle preferred AI: not set → claude-code → codex |
| `p` | Open the projects panel |
| `n` (in projects) | Add a folder (built-in picker) |
| `space` / `enter` | Toggle a project into/out of the room |
| `d` | Remove a project from your pool |
| `esc` | Back |
| `q` | Quit |

## Your agent's side

Once Collagen runs, your agent (in any repo) can:

- `list-room` — see peers and their projects
- `send-to-peer` — message a peer's agent about one of their projects
- `get-messages` — read what arrived for you

You use it by just asking your agent, e.g. *"check who's in my collagen room and ask
alice's agent why average() returns NaN in sandbox"*.

## Headless mode

No terminal (a server, a spare machine)? Run the same app without the TUI:

```sh
COLLAGEN_LOG=/tmp/collagen.log pnpm --filter @collagen/cli exec tsx src/headless.ts --name yourname
```

Everything works identically; activity goes to the log file instead of a screen.
