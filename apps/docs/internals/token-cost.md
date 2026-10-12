# Token cost

Collagen makes an AI do more: file decisions and forks, read reviews, call tools.
`token-cost` puts a number on that, so the cost can be weighed against what
collaborating around the code is worth — and so the heaviest operations can be
moved out of the AI and into collagen.

Ask your agent for it, or run it from a ticket's diagnostics row (`token cost`):
there it counts only the calls that named that ticket.

## Where the numbers come from

Collagen has no AI of its own. Its cost sits in the agents' sessions, and both
supported AIs already log those on your machine:

| AI | Log | What it gives |
| --- | --- | --- |
| Claude Code | `~/.claude/projects/<project>/<session>.jsonl` (and sub-agents' under `<session>/subagents/`) | every tool call and its result, MCP tools named `mcp__<server>__<tool>`; token usage per reply, cache reads included; `compact_boundary` lines with the trigger and the tokens before |
| Codex | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | `function_call` / `function_call_output` items; a `token_count` event per step with that step's input and the model's window size; `compacted` lines |

Both honour their own overrides (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`). Collagen's
calls are the ones on a server it registers as — `collagen`, `collagen-devnet`,
either with `-<profile>`. Only sessions that touched collagen in the last 30 days
(`days` to change it) are read, one file at a time, and nothing leaves the
machine: what comes out is counts and sizes, never what was said.

## Method

- **Tokens read** are the logs' own counts: per reply, everything the model was
  sent — fresh, cache-written and cache-read input.
- **Collagen's share** of them is estimated at 4 characters a token. A call's
  arguments and its result enter the window when the result comes back and stay
  there for every reply after, until the window is compacted; each reply is
  charged what collagen has in the window at that moment (never more than the
  window). Summed over the session, that is what collagen made the AI read.
- **Per tool**: calls, tokens in (what the agent wrote) and out (what it read),
  and the largest single result — the ranking to optimize from.
- **Tool definitions** are a standing cost: every collagen tool's description
  and schema, in the window whenever the AI loads them (Claude Code may defer
  them until searched for, so this is the most it costs, not what it always
  costs).

This is the share of a session collagen takes, not a comparison with the same
work done without collagen — that work (talking to a peer, reading their code,
explaining a change) would cost tokens too, and no log can say how many.

## Context window breaks

A break is the AI running out of window: a compaction it did on its own, or a
request refused as too long. A compaction the person asked for is not one. For
each break: the window before it, how many collagen calls the stretch since the
previous break had, how many tokens they carried, the largest one, and how many
distinct tickets those calls named. Many tickets with small results reads as
load (twelve reviews open at once); few tickets with one huge result reads as
bloat.

## First numbers

One machine, 30 days, Claude Code only: collagen was about 1% of the tokens
read, over 537 calls in 14 sessions, with 15 window breaks. By size:

- `get-tickets` returns the most — ≈120k tokens over 49 calls, up to ≈12k in
  one. A smaller default (open tickets, headlines only) is the first thing to try.
- `ask-review` and `propose` are the heaviest to write (≈78k and ≈32k tokens
  in): the decision and fork text. That is the part only the AI can do.
- `review-context` and `get-messages` return up to ≈4k and ≈8k at once.
- The definitions are ≈15k tokens for 43 tools; `ask-review`, `assume-review`,
  `report-bug` and `propose` are over 1k each.

## Not yet

Pooling these numbers across users — telemetry, opt-in or opt-out, through a
relay of our own — is still undecided. What `token-cost` reports is already
usage only (tool names, counts, sizes, times), so it is what such a report would
send.
