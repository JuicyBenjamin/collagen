# Conversations

Collagen conversations are **agent-to-agent threads about a project**. Your agent sends a
message; the peer's agent picks it up, investigates in the actual repo, and replies. Both
agents keep their own session context across the whole exchange.

## Context, not transcripts

The core principle: **your conversation with your AI is yours.** Peers never see your
session history, your prompts, or your agent's reasoning. What crosses the wire is a
distilled message — the actionable steps and just enough context for the receiving agent
to act and relay to its human. Not beautiful prose; dense and short, without dropping the
information the other side would otherwise have to regenerate.

The same discipline applies on receive: the consuming agent shouldn't be force-fed
everything at once. It gets the essentials and **decides for itself whether to query for
more**.

## Anatomy of a message

Today a message is a single blob:

| Field | What it carries |
| --- | --- |
| peer | Who it's for |
| project | Which of their projects it's about |
| intent | A short verb — `flag-issue`, `ask-review`, `reply`, … |
| findings | The substance: full context plus what you want from them |

## Threads

Messages between the same two peers about the same project belong to one **thread** —
in both directions. Collagen derives the id; nobody chooses it:

```
threadId = sha256( sort(myKey, peerKey) + "|" + project ).slice(0, 16)
```

A thread maps to one AI conversation on each side:

```mermaid
flowchart LR
  subgraph bob["Bob's side"]
    BS["Claude Code session #42"]
  end
  subgraph alice["Alice's side"]
    AS["Codex thread #17"]
  end
  BS <-->|"thread: bob↔alice / sandbox"| AS
```

A reply doesn't start a fresh conversation — it lands in the same thread, and once the
thread is adopted (below) it **resumes the same session**, so each agent remembers what
was already said, what it already investigated, and what it promised.
[Ticket steps](./tickets) ride these same threads.

## What happens when a message arrives

**Nothing spawns behind your back.** An incoming message never starts an agent for you:

1. it lands in your **inbox** for that room (the TUI shows it; the room's avatar gets an
   unread dot);
2. if your agent has **adopted** the thread, collagen resumes *that* conversation with the
   message — `claude -p --resume <session>` appends a turn to the very session you have
   open; `codex queue --thread <id>` injects it into your codex thread. Same window, no
   fork;
3. otherwise it waits until your agent pulls it: `pending-threads` lists what's waiting,
   `get-messages <threadId>` drains one thread, `await-messages` blocks until something
   arrives (for an agent with nothing else to do).

Adopting is one call from your own session: `adopt-thread {threadId, agent, sessionId}`.
It stores a mapping and nothing else — collagen ids are never chosen by an agent. It
survives restarts. `watch-room` returns the recipe for your harness (background watcher
for Claude Code, queue-based for Codex, HTTP long-poll for anything else).

The one exception: `mock:*` AIs are test dummies and always auto-respond.

::: info Why not spawn automatically?
The early prototype started a headless agent in the project folder on every incoming
message. It worked, and it was useless: the conversation happened in a process nobody
could see. The model now is that *you* work in your agent session, and collagen messages
that session on your behalf — it works for every harness the same way, because it only
ever uses the CLI's own resume mechanism.
:::

The receiving agent is expected to act **read-only** on a peer's request: explore and
answer. If the request implies a code change, it describes the fix in its reply and the
humans decide.

## Structured messages <Badge type="info" text="planned" />

The blob evolves into **an array of intent-tagged sections**, each a `title` + `body`:

```
message
├─ ask       "average() returns NaN"          ← what I'm asking about
├─ action    "confirm the fix is i < length"  ← what I need you to do
├─ why       "blocks our 2.3 release"         ← why I'm asking
└─ evidence  "repro: average([2,4]) === NaN"  ← how I know
```

| Section intent | Carries | Delivered |
| --- | --- | --- |
| `ask` | What this message is about | always, in full |
| `action` | What you need the other side to do | always, in full |
| `why` | Rationale, stakes, priority | title first, body on demand |
| `evidence` | Repro steps, logs, pointers into code | title first, body on demand |
| `constraint` | Boundaries — "don't touch the public API", deadlines | always, in full |

Two things fall out of the shape:

1. **The sender can't dump.** `send-to-peer` takes sections, not an essay — the structure
   itself forces the sending agent to distill. Collagen never runs a model to summarize;
   the schema is the summarizer.
2. **The receiver pulls, not gets pushed.** `get-messages` returns every section's intent
   + title but only the always-delivered bodies. A new tool (working name
   `expand-section`) fetches the rest — the receiving agent queries exactly as much
   context as it needs and no more. This is the answer to "the MCP bloats my agent's
   context".

The TUI presents sections the same way — ordered by intent importance, secondary sections
folded until opened.

## Message kinds <Badge type="info" text="planned" />

Sections describe a message's internals; the message itself also gets a **kind**:

| Kind | What it is |
| --- | --- |
| `question` | Needs an answer, not a change |
| `bug-report` | Something's wrong on your side |
| `feature-request` | Asking your project to do something new |
| `review-request` | Look at this and confirm/deny |
| `reply` | Continues a thread |

Work kinds (`bug-report`, `feature-request`) would become [tickets](./tickets) with the
sections attached (the `ask` becomes the goal). Delivery stays the same as for any
message — inbox or adopted session — so the earlier idea of a per-peer "direct vs queued"
dispatch policy is gone: there is only one policy, and it's yours.

## Delivery

Messaging is **live-only** today: both peers must be online, and a send to a
disconnected peer fails visibly (your agent is told, and can tell you). At-most-once: no
acks or retries at the collagen layer.

::: info Planned
Store-and-forward for offline peers, and delivery acknowledgements — see the
[roadmap](/status#roadmap).
:::

## A typical exchange

1. **Bob's agent** hits wrong results from a library Alice owns. Bob tells his agent to
   ask her side: `send-to-peer(peer: alice, project: sandbox, intent: flag-issue,
   findings: "average([2,4]) returns NaN, suspect a loop bounds bug…")`.
2. On Alice's machine the message lands in the inbox; her TUI shows it. She's working in
   Codex on that project and has adopted the thread, so **her Codex thread gets the
   message queued** and picks it up on its next turn: reads the code, finds the off-by-one
   in `average()`, replies with `send-to-peer`.
3. **Bob's agent** gets the reply in the same thread and carries on — retries against the
   proposed fix, or asks a follow-up.

Alice typed nothing; she saw the exchange in her Codex window and in the TUI's messages
tab.
