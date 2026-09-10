# End-to-end scenarios

Two or three real instances of the cli on a local hyperdht testnet, driven over
their MCP servers with `curl`, judged by their log files. These caught every
real bug the unit tests couldn't (connection stalls, a PubSub that dropped
history, two peers each bootstrapping a log, …). Run them after anything that
touches `packages/p2p` or the services.

```sh
pnpm --filter @collagen/cli e2e          # the deterministic set, side by side, ~1 minute
E2E_ONLY="log attach" pnpm --filter @collagen/cli e2e   # a few of them
E2E_JOBS=3 pnpm --filter @collagen/cli e2e              # fewer at once (default 6)
bash apps/cli/e2e/log.sh                 # one scenario, ~5 s
COLLAGEN_E2E_OUT=/tmp/x bash …           # where output goes (default $TMPDIR/collagen-e2e)
```

Prerequisites: `pnpm install`, `python3`. Nothing of yours is touched: every
scenario is an island with its own `HOME` under `$COLLAGEN_E2E_OUT/<scenario>/home`
(so its own `~/.config/collagen`, `~/.codex`, `~/.claude`), its own generated profiles
(`alice-<scenario>`, `bob-<scenario>`; `carol` is created on the fly), and its own
testnet. Profile names decide MCP ports, so scenarios never collide and run in
parallel. Instances start with `COLLAGEN_REGISTER=0`: no agent CLI is ever run to
register the MCP server.

There are no fixed sleeps. `mcp` waits for an instance to answer, `wait_for_peer` for
presence, `admitted <who>` for the log admission, `wait_until` for any condition — a
scenario is as slow as the thing it waits for, not as slow as a guess. A negative
assertion ("nothing reached bob") is the one place a short sleep stays.

| Scenario | Proves |
| --- | --- |
| `connect.sh` | two peers started together greet within seconds; the joiner is admitted to the room log |
| `ticket-thread.sh` | a ticket step is delivered on the same thread a plain message between those peers uses |
| `log.sh` | admission; a mock settling its step; a message to an **offline** member delivered on return; a solo restart keeping the ticket, re-delivering the pending step, keeping the unread ack |
| `conflict.sh` | two self-appointed creators: the lonely log yields, the ticket completes on the survivor |
| `three-members.sh` | three indexers: the view advances with 1 and 2 offline; the absent one catches up |
| `leave.sh` | leaving a room forgets it locally and moves focus; the last room can't be left |
| `outbox.sh` | no gate, and a receipt: an agent's `send-to-peer` / `create-ticket` reaches the peer at once (the tool answers with the outcome, not a promise), each is recorded in `LocalState.sent`, and the records survive a restart |
| `outbox-tui.sh` | the outbox in a pty: two messages and a ticket go out on the person's word; the overview lists the ticket at once with nothing about approval on screen; `3` opens the outbox — kind · project/ · who for · what about — `enter` unfolds the text one carried (a long body is capped, the brand above does not move), and `←` on the bar walks back through the tabs instead of leaving for the rail |
| `ticket-tui.sh` | the ticket page in a pty: ↓ to the tickets list, enter opens the ticket (cursor on its steps), ↓ walks to diagnostics, enter runs the transcripts diagnostic (the log shows the ask), esc returns to the list |
| `weigh-in.sh` | ticket updates reach everyone the ticket concerns: the creator hears bob settled (a `ticket-update` on her thread with him); carol, not asked, weighs in with a tagged message to alice — bob, owner but not recipient, hears she did |
| `transcripts.sh` | transcripts on request: bob adopted the pair thread into a fake codex session (rollout file in a temp `CODEX_HOME`); alice's `request-transcripts` reaches him and **waits** — nothing on her disk, the ask readable in his `list-transcripts` — until his `share-transcripts`, then the slice from adoption on comes back directly and is filed; older lines are not included; a second share finds nothing waiting |
| `review.sh` | review tickets, 0 to many reviewers: `ask-review` brings the why (branch and link read from the project's `.git`, decisions with how the user steered each one, forks with file:line); a hollow review is refused; the headline only in `get-tickets`, the why via `review-context` (whole, or `about` one file); with **nobody asked** the ticket has only the author's step and nothing is pushed to anyone; bob **posts** a review onto a step of his own, carol posts hers beside it, bob's second post revises his own, an **unasked** reader is welcome and takes nobody's step, settling someone else's step is refused, and the author's own step finishes the ticket; **amending** the why tells both readers the code moved; the why reads back with the author stopped |
| `review-tui.sh` | the why on screen: in alice's TUI ↑ from the steps reaches the ticket's `why` section (branch → base, counts, her summary), `enter` opens the why in full — each decision with `the user:` / `the agent:` and where it landed, each fork with the road not taken — `←` back to the ticket |
| `attach.sh` | attachments: alice `attach-files` a screenshot and a collected transcript to a ticket — references on the log, no file moves; bob's `fetch-attachments` lists them (name, type, size, holder, note) and fetches: bytes arrive directly, byte-identical, filed under `attachments/ticket-<id>/` with the record beside, the transcript with the transcripts (meta: origin, via); a missing path is refused; an unknown id is refused |

## Manual scenarios

Not in `run-all.sh` — they need something the machine may not have.

| Scenario | Needs | Proves |
| --- | --- | --- |
| `tui-sidebar.sh` | `pip install pyte` (set `PYTE_PATH` if not on `sys.path`) | the TUI in a pty: rooms rail, unread dot, online bubble, switching rooms, the `+` frame — rendered with a real terminal emulator (`render.py`) and judged from the key trace |
| `update.sh` | network, ~10 min (two global installs) | the in-app updater: the current build installed globally into a temp prefix, a fake registry (`fake-registry.py`) serving the same build as `9.9.9-alpha` and proxying everything else to npm; the TUI notices, `u` installs from it, the app exits 75 and the bin shim relaunches the new version in the same pty |

## Writing a scenario

- Build JSON arguments in a variable first, then pass the variable. macOS ships bash 3.2,
  which mangles `\"` escapes nested inside `"$( … )"` — the call reaches the server as
  invalid JSON (`-32700 Parse error`) while a loose assertion may still pass.
- Assert on the exact answer (`^"adopted: …`), not on a word that an error text might also
  contain. Assert tool calls in agent output by their `"tool":"…name"` form, never by the
  bare tool name — the message text under test may mention it.
- Profiles are generated fresh by `prep_profiles`, so a scenario never inherits another's
  state. Nothing waits for approval any more: what an agent sends goes out at once (see
  `outbox.sh`).
- Wait for the condition, never for a duration: `SA=$(mcp $A)` blocks until alice is up,
  `wait_for_peer` / `admitted bob` until bob is present and writing, `wait_until` for the
  rest. Files live under `$CFG` (the scenario's `~/.config/collagen`), never `$HOME`.
- Paths and the TUI: `HOME="$SHOME" … script -F -q "$PTY" bash -c "stty …; $TUI"` — `$TUI`
  is alice's TUI command for this scenario. Wait for the app to have PAINTED before the
  first key (`wait_pty "$PTY" tickets`): the opening animation mounts the app only once it
  has settled, and keys pressed before that are dropped.
- Assert about one ticket with `rows <url> <sid> <ticketId>`, not the whole `get-tickets`
  answer: step ids repeat across tickets (every reader's review step is
  `review-<their name>`), so a blob-wide pattern can pass on another ticket's step.
- Drive a peer with `drive_until <label> <pattern> <url> <sid> <json> <check cmd…>`, not a
  bare `drive-peer`. A drive is fire-and-forget over an ephemeral frame, and the first
  frame to a freshly connected peer can be dropped — the same drive sent twice always
  lands. `drive_until` re-sends until the effect shows, so only use it for idempotent
  actions (`settle-step` yes, `send-message` no). The peer must already hold the ticket:
  `wait_until … goals $B "$SB"` first.
- Start the room's creator first. A peer joining with `--room` alongside the creator can
  create a log of its own before hearing about theirs, and the room splits.

## Reading a failure

Start with the instance logs in `$COLLAGEN_E2E_OUT`. Connection lines say
`swarm connection: <key> out|in <host:port>` and `… closed · r<bytes>/w<bytes> · <reason>`;
`r0 … connection timed out` means the handshake worked and the data path did not.
`room log created|opened … writable=…`, `admitting …`, `admitted to the room log`
tell the admission story. Presence problems show as no `peer online` line.

Each peer's stderr is in `$COLLAGEN_E2E_OUT/<scenario>/<who>.err` — a crash that would
otherwise look like "the MCP server never answered" is there. `run-all.sh` prints the
FAIL lines and any stderr of a red scenario at the end.

Harness hygiene: the harness kills instances by pattern (`--profile <who>-<scenario>`),
never by the wrapper pid — an orphan keeps the deterministic MCP port and the next
instance silently moves to an ephemeral one while your curls hit the ghost.
