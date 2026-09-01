# Local development

## Prerequisites

- **Node ≥ 26.4.** Needed by OpenTUI's FFI bindings. `.nvmrc` pins 26 — run
  `nvm use` (or your version manager's equivalent) in the repo.
- **pnpm ≥ 10.**
- For the agent-spawn paths: the `claude` and/or `codex` CLIs installed and authenticated.

> **Why not Bun?** The p2p stack (hyperdht → udx-native) calls libuv functions Bun
> hasn't polyfilled on macOS/Linux (`uv_interface_addresses` panics as of Bun 1.4.0 —
> see [oven-sh/bun#18546](https://github.com/oven-sh/bun/issues/18546)). Stock Node runs
> it fine, and OpenTUI ≥ 0.5.7 no longer requires Bun.

## Install & typecheck

```sh
pnpm install
pnpm typecheck
```

## Tests

```sh
pnpm test                                  # all workspaces (turbo)
pnpm --filter @collagen/cli test:watch     # vitest watch mode
```

Tests never call real AI APIs or spawn real agent CLIs. The AI boundary in this
app is **process spawn**, and both sides of it are injectable:

- **`Adapters`** (`services/Adapters.ts`) — the spawn-adapter registry
  (`claude-code`, `codex`) is a `Context.Tag`, so tests provide a fake adapter
  instead of a real CLI.
- **`CommandExecutor`** — AgentRunner takes Effect's executor from context;
  tests provide an in-memory one that records each spawn and replies with
  scripted stdout (see `AgentRunner.test.ts`).

`Adapters.test.ts` pins the real CLIs' argument shapes (e.g. codex ≥0.152
rejecting `--sandbox` on `exec resume`) and output parsing.

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

Each opens the OpenTUI TUI (the `dev` script passes `--experimental-ffi`, which OpenTUI
needs on Node). For headless runs (no terminal), use `src/headless.ts` and watch the log
file:

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
- **`--experimental-ffi` is only for the TUI.** OpenTUI loads its native renderer over
  Node's experimental FFI; headless and testnet entries run plain `tsx` without it.
- **Concurrent registration.** Two instances registering at once can race on
  `~/.claude.json` (a one-off `claude mcp add exited 1`); it's idempotent and self-heals
  next start.
