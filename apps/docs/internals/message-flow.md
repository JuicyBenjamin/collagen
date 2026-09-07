# Message flow

A full round trip: Bob's agent sends a finding, Alice's agent picks it up in her own
session, acts, and replies — all on one thread.

## Sequence

```mermaid
sequenceDiagram
  autonumber
  participant BA as Bob's AI (his session)
  participant BC as Bob's CLI
  participant AC as Alice's CLI
  participant AR as AgentRunner (Alice)
  participant AA as Alice's AI (her session)

  BA->>BC: send-to-peer(peer=alice, project, findings)
  Note over BC: Room.sendTo derives the symmetric threadId,<br/>appends a msg entry to the room log
  BC-->>AC: log replicates (Corestore over Hyperswarm)
  Note over AC: apply → view → Room.messages → Inbox.push(roomId, msg, seq)<br/>TUI: messages tab + unread dot
  AC->>AR: runThread(threadId)
  alt thread adopted by Alice's session
    AR->>AA: claude -p --resume <session> / codex queue --thread <id>
    AA->>AC: get-messages(threadId)
    AC-->>AA: [the finding]
    Note over AA: investigates the repo, in the session Alice can see
    AA->>AC: send-to-peer(peer=bob, intent=reply)
  else not adopted
    Note over AC: waits — pending-threads / await-messages / GET /inbox/wait
  end
  AC-->>BC: log replicates (same threadId)
  Note over BC: Inbox.push → runThread → Bob's session continues
```

## Why the thread is symmetric

`send-to-peer` doesn't carry a thread id — Collagen derives one:

```
threadId = sha256( sort(myKey, peerKey).join("|") + "|" + project ).slice(0, 16)
```

Because the two keys are **sorted** before hashing, Bob→Alice and Alice→Bob about the
same project produce the **same** `threadId`. `adopt-thread` stores `threadId →
{agent, sessionId}` in the local state; a message on an adopted thread **resumes** that
session rather than starting anything, so the conversation has continuity for both agents.
An agent can never choose or change a thread id.

## Ticket steps take the same road

```mermaid
sequenceDiagram
  autonumber
  participant AA as Alice's AI
  participant AC as Alice's CLI
  participant BC as Bob's CLI
  participant BA as Bob's AI

  AA->>AC: create-ticket(s1: bob investigate, s2: alice review needs s1)
  AC-->>BC: ticket entry replicates (merged in every member's apply)
  Note over BC: s1 actionable for bob → mark suspended, broadcast
  BC->>BC: Inbox.push on thread(alice↔bob / project) → runThread
  BA->>BC: settle-step(s1, result)
  BC-->>AC: ticket entry replicates
  Note over AC: s2 actionable for alice → same thread(alice↔bob / project)
  AC->>AC: Inbox.push → runThread → Alice's session resumes with bob's result
```

The step's thread is the one between the ticket's creator and the step's owner about the
project (`stepThreadId`); the creator's own steps continue the thread with the peer whose
work they wait on. So the ticket's discussion and its status are one conversation.

## Per-thread serialization

Two deliveries on the same thread must not resume one session twice at once — concurrent
resumes corrupt its transcript. `AgentRunner.runThread`:

```mermaid
flowchart TD
  msg["message arrives"] --> lock{"thread\nsemaphore\nfree?"}
  lock -->|no| skip["return — holder will re-check"]
  lock -->|yes| run["runOnce: resume (or queue)"]
  run --> recheck{"new messages\narrived during run?"}
  recheck -->|yes| run
  recheck -->|no| release["release lock"]
```

A call that finds the lock taken returns immediately; the fiber holding it re-checks the
inbox after each run and loops if anything new arrived. No message is dropped, and no
thread runs twice at once.

## Delivery guarantees

- **Store-and-forward.** A message is an entry on the room's log, so `send-to-peer` to a
  member who is offline succeeds; they read it from whoever has the log when they are next
  online. Only a peer never admitted to the log is unreachable (`NotWritable` on your side
  says *you* aren't admitted yet).
- **Exactly-once into the inbox.** Each message has a log position; the inbox drops
  positions at or below the thread's pulled cursor and duplicates by id.
- **No read receipts.** The sender can't tell whether the recipient has pulled a message —
  see [Status](/status).
- **Tickets converge.** Every ticket change is a full-record entry merged in `apply` with
  deterministic rules; the log's order is the same for every member.
