# Tickets

A ticket is how multi-step work between peers is tracked instead of living only in chat
threads that scroll away. It is a **shared record**: one goal, a list of steps, each with
an owner, a dependency list, a status and — once done — a result. Every peer in the room
holds a merged copy, and the TUI shows it in the room's overview.

Tickets are **data, not commands**. Whether and how a step gets done is the owning
person's choice — their agent shows them the step and waits; settling it is their say,
approved in their outbox. A record can't force anyone's machine to do anything.

## A ticket

| Field | Notes |
| --- | --- |
| id | uuid, room-unique |
| project | which shared project it concerns |
| goal | the ask, one line |
| createdBy | peer key — authoritative for the ticket's structure |
| steps | see below |

A **step**:

| Field | Notes |
| --- | --- |
| id | `s1`, `s2`, … (or chosen) |
| owner | the peer expected to settle it — a peer or yourself |
| intent | short verb, like a message's (`investigate`, `review`, …) |
| description | what is being asked, in full |
| needs | step ids that must settle first |
| status | `pending` → `suspended` (delivered to the owner) → `settled` / `failed` |
| result | the owner's findings, or the failure reason |

```mermaid
flowchart LR
  s1["s1 · bob · investigate"] --> s2["s2 · alice · review\nneeds: s1"]
```

## How a step gets done

1. A step is **actionable** when its owner hasn't settled it and everything in `needs`
   has settled.
2. Collagen marks it `suspended` (so nothing re-triggers it) and delivers it to the owner
   as a message — on the **same thread a plain message would use** between the ticket's
   creator and that owner about that project. The message carries the step, the
   settled inputs it depends on, and the exact `settle-step` call to make.
3. What happens next follows the [messaging policy](./conversations#what-happens-when-a-message-arrives):
   if the owner's agent has adopted that thread, their conversation resumes with the
   step in it; otherwise it waits in their inbox until they pull it. Nothing is spawned
   for them, and the agent is told to show the step to its person, not to start on it.
4. The owner decides whether and how it gets done — themselves, or by directing their
   agent. When they say it's done (or declined), their agent calls `settle-step` with the
   result they want to send; it waits in their outbox until they approve. The merged
   ticket is then broadcast; steps waiting on this one become actionable on *their*
   owners' side.

Because a ticket has no thread of its own, "the discussion about this work" and "the
status of this work" travel together: the ticket in the overview, its exchange in the
messages tab, both about the same thread.

### A review gate

There is no separate `review` status. Want the requester to confirm before the work counts
as done? Make the confirmation a step:

```
s1  owner: bob    investigate  "what does average() do"
s2  owner: alice  review       "check bob's answer"   needs: s1
```

Bob's settled result becomes the input to alice's review step, which is delivered to alice
on her thread with bob — the same conversation where she would have asked in the first
place.

## The tools

| Tool | Purpose |
| --- | --- |
| `create-ticket` | goal, project, steps (owner by peer name, intent, description, `needs`) — queued for your approval |
| `settle-step` | settle or fail a step you own, with the result you want to send — queued for your approval |
| `get-tickets` | every ticket in the room you're looking at, merged, with owners resolved to names |

Prefer a ticket over a chain of `send-to-peer` when the work has more than one step or
more than one owner — the intermediate state stays inspectable by everyone, and the
dependency order is enforced by delivery, not by remembering.

## In the TUI

The overview tab lists the room's tickets: goal, project, `settled/total` — `⧉` while in
flight, `✓` when every step has settled, `✗` if one failed. `enter` opens the ticket's own
page — the tab bar gives way to a `‹ overview › ticket …` crumb — with its **steps** with owner, status (`·` pending, `⟳` delivered, `✓` settled, `✗` failed)
and result; the **conversation** on its threads (every message between the creator and the
owners about this work, `enter` for the full text); and **diagnostics** that apply to it —
today "ask peers for their agents' conversations" ([transcripts](./conversations#transcripts-on-request))
and "conversations collected so far". `esc` goes back to the list.

## Sync model

Tickets live on the room's **log** — an [Autobase](https://github.com/holepunchto/autobase)
every member writes to and every member holds a copy of (see
[Architecture](/internals/architecture#the-room-log-autobase)). Creating or settling
appends the whole ticket record; every member's `apply` folds it into the room's view with
rules that converge regardless of order:

- steps are unioned by id — the creator adds structure, owners never lose steps
- per step, the higher status wins (`settled`/`failed` beat `suspended` beat `pending`);
  equal ranks resolve by timestamp, then a deterministic tiebreak
- the goal follows the newest timestamp

Because it's a replicated log, tickets survive everyone restarting, and a member who was
offline catches up on reconnect — including steps that became theirs while they were away.

## What changed from the original plan

The first spec was a mini-Jira: columns `todo / doing / review / done / blocked /
wont-do`, an assignee, a status history. It was replaced by the step model above before
any of it shipped: agents need dependencies and results more than columns, several peers
can own parts of one ticket, and a review gate is just a step. Human-facing board views
can still be derived from the steps if they turn out to be wanted.
