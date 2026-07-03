# Local development

## Prerequisites

- **Node ≥ 20.** The p2p stack (Hyperswarm/hyperdht) needs modern Node; some shells here
  default to an old version, so confirm with `node -v`.
- **pnpm ≥ 10.**
- For the agent-spawn paths: the `claude` and/or `codex` CLIs installed and authenticated.

## Install & typecheck

```sh
pnpm install
pnpm -r typecheck
```

## Running the docs

```sh
pnpm --filter @collagen/docs dev      # this site, with HMR
pnpm --filter @collagen/docs build    # static build (also our "typecheck")
```

## Running the app

Collagen is peer-to-peer, so testing means **two instances**. On one machine we simulate
two peers with separate **profiles** (each gets its own identity, state file, and MCP
port).

### 1. Start a local testnet

The public DHT hairpins on localhost, so dev uses a local one:

```sh
pnpm --filter @collagen/cli dev:net
```

This writes `~/.config/collagen/dev-bootstrap.json`, which clients auto-detect.

### 2. Start two peers

```sh
pnpm --filter @collagen/cli dev -- --profile alice --name alice
pnpm --filter @collagen/cli dev -- --profile bob   --name bob
```

Each opens the Ink TUI. For headless runs (no terminal), use `src/headless.ts` and watch
the log file:

```sh
COLLAGEN_LOG=/tmp/alice.log pnpm --filter @collagen/cli exec tsx src/headless.ts --profile alice --name alice
```

### 3. Drive a message

Either ask a real agent to use the `list-room` / `send-to-peer` tools, or hit the MCP
server directly. Ports are derived from the profile name (`portForProfile`):

```sh
curl -s -X POST http://127.0.0.1:<port>/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"list-room","arguments":{}}}'
```

## Profiles, ports, and files

| Concept | Where |
| --- | --- |
| Identity (seed + name) | `~/.config/collagen/identity-<profile>.json` |
| Local state (AI, projects, rooms) | `~/.config/collagen/state-<profile>.json` |
| Dev bootstrap | `~/.config/collagen/dev-bootstrap.json` |
| MCP port | `portForProfile(profile)` → 41000–44999 |
| MCP server name | `collagen` (default) or `collagen-<profile>` |

## Gotchas

- **Harness env leaks into spawned agents.** If you spawn from inside another agent
  session, variables like `ANTHROPIC_BASE_URL` are inherited and can 401 the child. Strip
  them when testing spawns.
- **Non-TTY runs.** Ink's `isRawModeSupported` is `undefined` (not `false`) on non-TTY
  stdin; input handlers guard with `Boolean(...)` so headless runs don't crash.
- **Concurrent registration.** Two instances registering at once can race on
  `~/.claude.json` (a one-off `claude mcp add exited 1`); it's idempotent and self-heals
  next start.
