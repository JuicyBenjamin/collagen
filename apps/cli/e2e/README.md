# End-to-end scenarios

Two or three real instances of the cli on a local hyperdht testnet, driven over
their MCP servers with `curl`, judged by their log files. These caught every
real bug the unit tests couldn't (connection stalls, a PubSub that dropped
history, two peers each bootstrapping a log, …). Run them after anything that
touches `packages/p2p` or the services.

```sh
pnpm --filter @collagen/cli e2e          # the deterministic set, ~4 minutes
bash apps/cli/e2e/log.sh                 # one scenario
COLLAGEN_E2E_OUT=/tmp/x bash …           # where logs go (default $TMPDIR/collagen-e2e)
```

Prerequisites: `pnpm install`, `python3`, and the test profiles `alice` and
`bob` in `~/.config/collagen` (any two profiles that share the room `st-test3`;
the scripts set the parts they depend on — alice creates the room's log and has
no AI, bob is a `mock:codex` joiner — and restore them afterwards). `carol` is
created on the fly.

| Scenario | Proves |
| --- | --- |
| `connect.sh` | two peers started together greet within seconds; the joiner is admitted to the room log |
| `ticket-thread.sh` | a ticket step is delivered on the same thread a plain message between those peers uses |
| `log.sh` | admission; a mock settling its step; a message to an **offline** member delivered on return; a solo restart keeping the ticket, re-delivering the pending step, keeping the unread ack |
| `conflict.sh` | two self-appointed creators: the lonely log yields, the ticket completes on the survivor |
| `three-members.sh` | three indexers: the view advances with 1 and 2 offline; the absent one catches up |
| `leave.sh` | leaving a room forgets it locally and moves focus; the last room can't be left |

## Manual scenarios

Not in `run-all.sh` — they need something the machine may not have.

| Scenario | Needs | Proves |
| --- | --- | --- |
| `tui-sidebar.sh` | `pip install pyte` (set `PYTE_PATH` if not on `sys.path`) | the TUI in a pty: rooms rail, unread dot, online bubble, switching rooms, the `+` frame — rendered with a real terminal emulator (`render.py`) and judged from the key trace |
| `codex-adopt.sh` | `codex` logged in | first contact queues; `adopt-thread` into a codex conversation; the next message is queued into that conversation; codex reads the thread and replies; the mock acks |
| `claude-adopt.sh` | `claude` logged in | same loop with `claude -p --resume` into a Claude Code session — pass the session id as `$1` |

## Reading a failure

Start with the instance logs in `$COLLAGEN_E2E_OUT`. Connection lines say
`swarm connection: <key> out|in <host:port>` and `… closed · r<bytes>/w<bytes> · <reason>`;
`r0 … connection timed out` means the handshake worked and the data path did not.
`room log created|opened … writable=…`, `admitting …`, `admitted to the room log`
tell the admission story. Presence problems show as no `peer online` line.

Harness hygiene: kill instances by pattern (`pkill -f src/headless.ts`), never by
the wrapper pid — an orphan keeps the deterministic MCP port and the next
instance silently moves to an ephemeral one while your curls hit the ghost.
