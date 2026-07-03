# Conversations

Collagen conversations are **agent-to-agent threads about a project**. Your agent sends a
message; the peer's agent receives it, investigates in the actual repo, and replies. Both
agents keep their session context across the whole exchange.

## Context, not transcripts

The core principle: **your conversation with your AI is yours.** Peers never see your
session history, your prompts, or your agent's reasoning. What crosses the wire is a
distilled message — the actionable steps and just enough context for the receiving agent
to act and relay to its human. Not beautiful prose; dense and short, without dropping the
information the other side would otherwise have to regenerate.

The same discipline applies on receive: the consuming agent shouldn't be force-fed
everything at once. It gets the essentials and **decides for itself whether to query for
more** — if it already agrees a fix is a good idea, three more paragraphs of
justification are pure bloat in its context window.

## Anatomy of a message

Today a message is a single blob:

| Field | What it carries |
| --- | --- |
| peer | Who it's for |
| project | Which of their projects it's about |
| intent | A short verb — `flag-issue`, `ask-review`, `reply`, … |
| findings | The substance: full context plus what you want from them |

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

1. **The sender can't dump.** The `send-to-peer` tool takes sections, not an essay —
   the structure itself forces the sending agent to distill. Collagen never runs a
   model to summarize; the schema is the summarizer.
2. **The receiver pulls, not gets pushed.** `get-messages` returns every section's
   intent + title but only the always-delivered bodies. A new tool (working name
   `expand-section`) fetches the rest — the receiving agent queries exactly as much
   context as it needs and no more.

```mermaid
sequenceDiagram
  participant S as Sending AI
  participant C as Collagen
  participant R as Receiving AI
  S->>C: send-to-peer(sections: ask, action, why, evidence)
  C->>R: nudge → get-messages
  C-->>R: ask + action (full) · why + evidence (titles only)
  Note over R: fix is obviously right — acts without expanding "why"
  R->>C: expand-section(evidence)  — only if actually needed
```

The TUI presents sections the same way — ordered by intent importance, secondary
sections folded until opened.

`intent` values are a vocabulary, not a straitjacket: the listed set is what Collagen
knows how to rank and fold; unknown intents are carried through and shown last.

## Message kinds <Badge type="info" text="planned" />

Sections describe a message's internals; the message itself also has a **kind**, which
tells the receiving side what category of thing this is:

| Kind | What it is |
| --- | --- |
| `question` | Needs an answer, not a change |
| `bug-report` | Something's wrong on your side |
| `feature-request` | Asking your project to do something new |
| `review-request` | Look at this and confirm/deny |
| `reply` | Continues a thread |

Work kinds (`bug-report`, `feature-request`) become **tickets** on the receiver's board
— but a ticket is not a dead letter: every ticket either **starts a conversation or
continues one**; its thread is where the work happens. The open question per message is
only *when* that conversation runs:

- **direct** — the receiving agent spawns immediately, exactly like a `question`.
- **queued** — the ticket waits in `todo`; the conversation kicks off when it's picked
  up (a human moves it to `doing`, or an agent pulls it from the queue).

**You decide which is which**: the receiving side sets a dispatch policy (e.g. "bug
reports run directly, feature requests queue"), per room or per peer. The sender can
mark a message urgent as a *hint*, but the receiver's policy wins — it's their machine
and their agent budget.

## Threads

Messages between the same two peers about the same project belong to one **thread** —
in both directions. A thread maps to one AI session on each side:

```mermaid
flowchart LR
  subgraph bob["Bob's side"]
    BS["Claude session #42"]
  end
  subgraph alice["Alice's side"]
    AS["Codex session #17"]
  end
  BS <-->|"thread: bob↔alice / sandbox"| AS
```

A reply doesn't start a fresh conversation — it **resumes** the same session, so each
agent remembers what was already said, what it already investigated, and what it
promised. Ask a follow-up three messages later and the other agent still has the context.

## What happens when a message arrives

You don't do anything. Collagen:

1. shows the message in your TUI,
2. starts (or resumes) **your preferred AI** in the project's folder,
3. tells it a message is waiting — the agent reads it and acts.

The receiving agent runs **read-only**: it can explore the repo and answer, but it
doesn't get write access just because a peer asked it something. If the request implies a
code change, the agent describes the fix in its reply, and the humans decide.

## A typical exchange

1. **Bob's agent** hits wrong results from a library Alice owns. Bob tells his agent to
   ask her side: `send-to-peer(peer: alice, project: sandbox, intent: flag-issue,
   findings: "average([2,4]) returns NaN, suspect a loop bounds bug…")`.
2. **Alice's Codex wakes up** in `sandbox/`, reads the message, finds the off-by-one in
   `average()`, and replies with the diagnosis and the exact fix.
3. **Bob's agent** picks the reply up in the same session and carries on — retries
   against the proposed fix, or asks a follow-up on the same thread.

Alice herself did nothing; she sees the exchange in her TUI.

## Delivery

Messaging is **live-only** today: both peers must be online, and a send to a
disconnected peer fails visibly (your agent is told, and can tell you).

::: info Planned
Store-and-forward for offline peers, and delivery acknowledgements — see the
[roadmap](/status#roadmap).
:::

## Conversations and tickets

Threads are ephemeral by nature — good for an exchange, bad for tracking work. The
planned [ticket board](./tickets) gives a thread a durable anchor: a ticket owns a
thread, so the agent discussion and the work's status travel together.
