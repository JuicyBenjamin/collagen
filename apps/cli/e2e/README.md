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
| `approval.sh` | human in the loop, sending side: a non-mock peer's `send-to-peer` / `create-ticket` queue for approval and nothing reaches the other side; a mock is not gated; the queued proposals survive a restart |
| `approval-tui.sh` | the gate from the person's side, TUI in a pty: two queued messages wait at the bottom of the messages tab; `2` then ↓ lands on the newest, `n` drops it, `y` sends the other (bob gets exactly that one) — judged from logs and the key trace, no pyte needed |
| `ticket-tui.sh` | the ticket page in a pty: ↓ to the tickets list, enter opens the ticket (cursor on its steps), ↓ walks to diagnostics, enter runs the transcripts diagnostic (the log shows the ask), esc returns to the list |
| `weigh-in.sh` | ticket updates reach everyone the ticket concerns: the creator hears bob settled (a `ticket-update` on her thread with him); carol, not asked, weighs in with a tagged message to alice — bob, owner but not recipient, hears she did |
| `transcripts.sh` | transcripts on request: bob adopted the pair thread into a fake codex session (rollout file in a temp `CODEX_HOME`); alice's `request-transcripts` reaches him, the slice from adoption on comes back directly and is filed; older lines are not included; `list-transcripts` sees it |
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
- Every `start`ed headless peer runs with `COLLAGEN_AUTO_APPROVE=1`; to test the human gate
  itself, start that peer with `COLLAGEN_AUTO_APPROVE=0` (see `approval.sh`). Profiles are
  generated fresh by `prep_profiles`, so a scenario never inherits another's state.
- Wait for the condition, never for a duration: `SA=$(mcp $A)` blocks until alice is up,
  `wait_for_peer` / `admitted bob` until bob is present and writing, `wait_until` for the
  rest. Files live under `$CFG` (the scenario's `~/.config/collagen`), never `$HOME`.
- Paths and the TUI: `HOME="$SHOME" … script -F -q "$PTY" bash -c "stty …; $TUI"` — `$TUI`
  is alice's TUI command for this scenario.

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
