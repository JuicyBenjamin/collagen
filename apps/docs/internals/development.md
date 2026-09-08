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

`pnpm install` also patches the local TypeScript with the
[Effect language service](https://github.com/effect-ts/tsgo) (the root `prepare`
script), so `tsc` reports Effect-specific diagnostics (floating effects, missing
context, outdated v4 APIs, …) alongside type errors, and editors using the
workspace TypeScript get the same hints inline (VS Code: accept the "use
workspace version" prompt; `.vscode/settings.json` opts into tsgo).

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
rejecting `--sandbox` on `exec resume`) and output parsing. `RoomLog.test.ts`
runs the log's `apply` on a real Corestore in a temp dir.

### End-to-end

```sh
pnpm --filter @collagen/cli e2e        # ~4 minutes, needs the alice/bob profiles
```

Real instances on a local testnet, driven over MCP, judged from their logs — see
[`apps/cli/e2e/README.md`](https://github.com/JuicyBenjamin/collagen/tree/main/apps/cli/e2e)
for the scenarios, prerequisites and how to read a failure. Run it after anything
that touches `packages/p2p` or the services; the unit tests can't see connection
stalls, dropped history or two peers each bootstrapping a log — these did.

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

This writes `~/.config/collagen/dev-bootstrap.json`, which clients auto-detect. A client
that finds it builds its DHT node with `firewalled: false` (everything is on this host —
the same thing hyperdht's testnet helper does for its own nodes); two local peers then
connect in well under a second. If they don't, read the `swarm connection … closed`
lines in the log first — they carry the target address, bytes each way, and the reason.

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

### Mocked agents (development only)

`a` cycles past the real agents to **mock:claude-code** / **mock:codex**. A mock is a test
dummy, not a substitute for an agent: an incoming message spawns `src/dev/mock-agent.mjs` instead of
a CLI, which does the MCP handshake, reads the thread and answers with a canned `mock-ack`
(capped at 3 per thread; mocks never answer mocks). It's what the e2e scenarios talk to, and
it's the one kind of AI that auto-responds — everyone in the room sees the `mock:` prefix.
`drive-peer` remote-controls a mock (send a message, create a ticket, settle a step) so one
machine can exercise both sides of a flow; real peers ignore drive requests.

## Profiles, ports, and files

| Concept | Where |
| --- | --- |
| Identity (seed + name) | `~/.config/collagen/identity-<profile>.json` |
| Local state (AI, projects, adopted threads, inbox cursors) | `~/.config/collagen/state-<profile>.json` |
| Corestore (the rooms' logs) | `~/.config/collagen/store-<profile>/` |
| Dev bootstrap | `~/.config/collagen/dev-bootstrap.json` |
| MCP port | `portForProfile(profile)` → 41000–44999 |
| MCP server name | `collagen` (default) or `collagen-<profile>` |

## UI code layout (apps/cli/src)

The TUI borrows the web's vocabulary so changes are easy to say out loud.

- **`routes/`** — frames (pages). A frame is a folder with a `page.tsx`; nested
  frames nest folders (`routes/room/overview`, `routes/room/messages` are the
  room's tabs). A `layout.tsx` next to frames wraps them: `routes/layout.tsx`
  is the brand header every frame sits in; `routes/room/layout.tsx` adds the
  rooms sidebar, the status line, the room panel with its tab bar, the
  footer, and the global keys, and renders the active tab as `children`.
  `routes/settings` and `routes/new-room` (the sidebar's `+`) are full
  frames of their own, like Discord's settings screen.
- **`components/`** inside a frame or layout folder holds *its* child
  components, one folder each (`routes/room/components/Footer/Footer.tsx`);
  children that have children repeat the pattern. Siblings live side by side.
- **Top-level `components/`** — app-agnostic primitives shared across frames
  (`Panel`, `FsPicker`, key helpers). App-specific pieces two frames share
  sit in the lowest folder above both: `routes/components/RoomChooser` is
  the join-or-create question used by setup and by new-room.
- **`atoms.ts` sits at the lowest folder shared by everything that reads it**:
  `routes/atoms.ts` for state every frame needs, `routes/room/atoms.ts` for
  what several room sections share, `…/Footer/atoms.ts` for what only the
  footer reads. `app/runtime.ts` holds the runtime atom they all derive from;
  `app/session.tsx` is the one context — who you are and which room you're in —
  owned by `app/app.tsx` once setup is done.
- **Logic lives with its UI.** A section the cursor can land on is a
  `<Focusable id hint onKey …boxProps>` (shared component in `components/`).
  It is the box around the section's content, so it knows its own place on
  screen. The section decides what a key means while hovered and returns
  `true` to consume it; an arrow it leaves alone moves focus to whichever
  Focusable lies in that direction — worked out from the rendered layout,
  never configured. A component knows nothing about its neighbors: move it,
  and navigation follows. Focus, keyboard capture (the folder picker) and the
  registered hints are plain atoms in `components/focus.ts`; the footer shows
  the hovered section's hint without knowing the sections exist. No prop
  drilling — shared state is an atom at the lowest common ancestor.
- **`app/`** — the shell: `app.tsx` (maps routes to layouts and pages),
  `router.tsx` (a tiny route state), `session.tsx`, `theme.ts`, `runtime.ts`.
  `src/` itself holds only the two entries (`index.tsx`, `headless.ts`) and
  folders: `app/`, `routes/`, `components/`, `services/` (incl. `Rooms`: every joined room live, one focused), `config/` (cli
  flags, profile file), `dev/` (testnet, mock agent), `lib/` (pure helpers) (setup is the frame shown before a session exists, so it is not a
  route).

To add a tab: create `routes/room/<name>/page.tsx`, add the route to
`router.tsx` and `app.tsx`, wrap its sections in `<Focusable>` with an id and a hint. To add a
section inside a tab: a folder under that tab's `components/` with the
component (and `atoms.ts` if it needs runtime state nobody else reads).

## Workflow: branches, commits, staging

Work happens on branches and lands on `main` by **rebase merge**, so every commit
arrives as-is and becomes a line in the release notes. Every commit is therefore a
conventional commit — `commitlint` checks each PR's commits (types: the conventional
set; scopes: `cli`, `p2p`, `docs`, `e2e`, `deps`, `release`, `main`, `ci`). Squash is
allowed for a genuinely messy branch; merge commits are off.

```sh
git switch -c feat/rooms-rail
# … commits like: feat(cli): rooms rail · fix(p2p): retry admission · docs: rail keys
gh pr create --fill
gh pr merge --rebase --auto      # merges when ci is green
git switch main && git pull     # picks up the bot's release commit too
```

**Staging** for a peer-to-peer app is separate identities and rooms, not servers:
`pnpm dev -- --profile staging` runs a dev build with its own identity, state, store,
MCP port and MCP server name next to your real install; join a **staging room** (its own
invite id) from your dev machines and never the real one. Same-machine: the local testnet
below. A newer *app* version in a real room is harmless; a new *protocol* version shows
peers as `⚠ other collagen version` — by design.

## Building and releasing

The published package is **`@collagen/cli`** (`npx @collagen/cli`, command `collagen`).
`packages/p2p` is bundled into it and is never published on its own.

```sh
pnpm --filter @collagen/cli build     # tsup → apps/cli/dist (TUI + headless entries)
node apps/cli/bin/collagen.js --version
pnpm --filter @collagen/cli pack      # the exact tarball npm would get
```

- `bin/collagen.js` re-runs Node with `--experimental-ffi` (OpenTUI's renderer) and
  refuses Node < 26.4; with `--headless` it runs the headless entry (no FFI) instead. One
  bin on purpose: `npx @collagen/cli` can only pick an executable on its own when the
  package has exactly one (or one named like the package).
- The version is baked in at build time from `package.json`; `pnpm dev` reports `dev`.
- **In-app update** (`src/services/Updates.ts`): 10 s after start and every 6 h the app
  asks the registry (`COLLAGEN_REGISTRY`, default npmjs) for `@collagen/cli/latest`; a newer
  version goes to the status line, the log and `list-rooms`. `u` picks a plan from where the
  running file lives — npm global (`…/lib/node_modules/@collagen/cli/`) or pnpm global get
  reinstalled with that tool, `npx` (`/_npx/`) is told to restart, a source run to pull —
  and on success exits with `RESTART_EXIT_CODE` (75), which `bin/collagen.js` turns into a
  relaunch with the same args. `COLLAGEN_NO_UPDATE_CHECK=1` disables the check; a `dev`
  build never checks. `e2e/update.sh` proves the whole loop against a fake registry.
- The **protocol version** (`PROTOCOL_VERSION` in `packages/p2p/src/schema.ts`) is
  separate from the package version: bump it whenever frames, log entries or the view
  layout change — peers on another protocol are flagged, not silently dropped.

**Release flow (release-please, lockstep):** commits are the release notes. On every push
to `main` the `release` workflow reads the conventional commits since the last release and
keeps one release PR current. All packages share **one version** (like Effect, MUI, Angular:
same number = built and tested together): `@collagen/cli` and `@collagen/p2p` bump in step,
each with its own `CHANGELOG.md` of its own commits (attributed by path), grouped Features /
Bug Fixes with each line labelled by scope (`**cli:** …`). Versioning is plain semver with a
constant pre-release label while collagen is alpha: `feat` → `0.2.0-alpha`, `fix` →
`0.1.1-alpha`, `feat!` / `BREAKING CHANGE:` → major (pre-1.0: minor) — never `-alpha.1`.
That's our own small strategy (`scripts/labelled-versioning.mjs`, registered by
`scripts/release.mjs`, which runs release-please as a library); graduating is one line in
`release-please-config.json`: `prerelease-type: beta`, then removing `versioning` and
`prerelease` for `0.x.y` proper.
`docs`, `test`, `chore`, `ci`, `build`,
`refactor` are hidden and never trigger a release — the type is the fence, the scope is the
label: user-facing work is `feat(cli|p2p):` or `fix(cli|p2p):`, documentation is `docs(...)`.
Merging the PR tags `cli-vX.Y.Z` and `p2p-vX.Y.Z`, creates the GitHub Releases with the
notes, and publishes `@collagen/cli` (p2p is bundled into it, never published) through npm's
**trusted publishing** (GitHub OIDC — configured on npmjs.com under the package's settings:
repository `JuicyBenjamin/collagen`, workflow `release.yml`; no token in the repo). Adding a
package later is one more entry in `release-please-config.json`.

**Zero-touch:** with a repo secret `RELEASE_TOKEN` (fine-grained PAT for this repo:
Contents + Pull requests write) and "Allow auto-merge" enabled, the release PR merges
itself once `ci` is green, and the merge triggers the publish — every push with a `feat`
or `fix` becomes a release within minutes; nothing else does. Without the secret the PR
waits for a human merge (merges made with the default `GITHUB_TOKEN` would not re-trigger
the workflow — GitHub's loop guard — which is why the PAT is needed for the automatic
path). The bot's release commit only touches versions and changelogs; `git pull` before
your next push.

One-time, by hand: the very first version can't use trusted publishing (the package has
to exist first) — `npm login` then `pnpm --filter @collagen/cli publish --access public`
— then set up the trusted publisher on npmjs.com. `ci.yml` runs typecheck, tests and a
build on every push and PR.

## Gotchas

- **Harness env leaks into spawned agents.** If you spawn from inside another agent
  session, variables like `ANTHROPIC_BASE_URL` are inherited and can 401 the child. Strip
  them when testing spawns.
- **`--experimental-ffi` is only for the TUI.** OpenTUI loads its native renderer over
  Node's experimental FFI; headless and testnet entries run plain `tsx` without it.
- **Concurrent registration.** Two instances registering at once can race on
  `~/.claude.json` (a one-off `claude mcp add exited 1`); it's idempotent and self-heals
  next start.
