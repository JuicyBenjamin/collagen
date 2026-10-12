# Roles and outsiders in a room

An investigation, not a feature: whether a peer-to-peer room can have tiers of people
— outsiders who read everything and file issues, promotion and demotion, removing
someone — and what it would take. Written 2026-10-12 against protocol 10 and Autobase
7.28.

**Short answer: yes, all three, but not on today's log.** Every tier needs one thing
the room does not have yet: `apply` knowing *who* wrote each entry. With that in place,
roles are ordinary replicated records, outsiders are Autobase's optimistic writers, and
removal is a move to a new log without the person — the way Holepunch describes it for
Pear.

## Where the room stands today

| | Today |
| --- | --- |
| Joining | The room id is the invite. Anyone holding it greets, hears the log key (`log-info`), asks `join-log`, and the first writable member admits them (`Room.admitPending`). No person decides. |
| Standing | Every member is a writer **and** an indexer (`add-writer` with `indexer: true`). One tier. |
| Reading | A Hypercore key is a read capability. Whoever has the log key can replicate it from any member (`store.replicate(conn)` serves the whole Corestore on every connection). The log is not encrypted. |
| Who may change what | `settleStep`, `postReview`, "only the author writes a review" — checked in `Dispatch` on the **writer's** machine. `apply` never looks at who wrote an entry. |
| Identity on the log | `member { key, name }`, `msg.from`, `ticket.createdBy` are what the entry *says*. Nothing ties a writer core to an identity key. |
| Leaving | Local (`Rooms.leave`). The others keep the room; nobody can be put out. |

The last two rows matter most. Swarm connections are authenticated (the Noise handshake
proves the peer's identity key), so ephemeral frames know who sent them. Log entries do
not: a member running a modified build can write a ticket "created by" someone else, a
message "from" someone else, or settle a step that is not theirs, and every peer applies
it. That is acceptable among people who trust each other — the room today — and it is
the first thing that breaks once some people have less standing than others.

## The foundation: who wrote this entry

Autobase hands `apply` each node with `node.from.key`: the writer core it came from,
signed by that core. What is missing is the link from a core to a person.

- A member's first entry binds them: `bind { identity, writer, sig }`, where `sig` is the
  identity key's signature over `collagen-bind | <log key> | <writer core key>`
  (`hypercore-crypto` `sign` / `verify`; the identity keypair is the swarm's).
- `apply` accepts a `bind` only when `node.from.key === writer` and the signature
  verifies, and keeps `writer/<core key> → identity`. First binding of a core wins.
- Every other entry is then judged by `writerOf(node)`, not by what it claims:
  `msg.from`, `ticket.createdBy` on a new ticket, a step's settler, a review's author.
  The checks that live in `Dispatch` today (`settleStep`, `postReview`) move into
  `apply` as well, so they hold on every peer whatever build wrote the entry.

Existing rooms have entries from before any binding. A core with no binding is treated
as a member (the room's standing today) until it binds; binding is automatic on the next
open. This is a protocol change (`PROTOCOL_VERSION` bump, a new `LogOp`). As with any
bump, a build that predates it holds *every* entry a newer build writes as unseen until
it updates (`apply` skips entries stamped with a newer protocol), and it still applies
older builds' entries without asking who wrote them. So the gap only closes once
everyone in the room has updated.

Nothing in this step is visible to a person. It is still the step to take first: it
closes the forging gap on its own, and every tier below is a rule written against it.

## Roles: promote and demote

Roles are records on the log, applied in `apply`:

```
role { id, identity, role: "admin" | "member" | "outsider" | "removed" }
```

- **Who may write one:** an entry is honoured when `writerOf(node)` holds `admin` *at
  that point in the log*. The creator is the first admin (the bootstrap core binds to
  them). An admin may not demote the last admin — the same rule Autobase uses for the
  last indexer (`host.removeable`).
- **When peers disagree on order:** they do not, for long. Autobase linearizes every
  writer's entries into one order and re-runs `apply` when a causal fork reorders them,
  so "was the writer an admin when this entry applied" has one answer on every peer.
  Alice demoting Bob while Bob demotes Alice: whichever the linearizer puts first
  applies; the second is refused, because its writer is no longer an admin.
- **What can still move:** entries past `base.signedLength` — not yet signed by a quorum
  of indexers — may still be reordered. For a moment Bob may look demoted on one machine
  and not on another; it settles when the order is signed. Role changes should show as
  pending until then.

This is the first piece of room state whose *outcome* depends on order rather than
merging to the same value from any order (see the `replicated-merges` skill). That is
sound here because it is apply's linear order, the same on every peer — never wall
clocks, never arrival.

Indexers: admins and members stay indexers (fine at room scale, as today). Outsiders are
never indexers; a demotion to `outsider` or `removed` calls `host.removeWriter` for that
person's cores.

## Outsiders: read everything, file issues

**Reading** costs nothing: an outsider holds the log key and replicates the log like
anyone. They are simply never admitted.

**Filing** uses Autobase's optimistic appends. The base opens with `optimistic: true`;
an outsider appends `{ op: "issue", … }` with `{ optimistic: true }` without being a
writer. On every member, `apply` sees the node from a core that is not a writer and
acknowledges it (`host.ackWriter(node.from.key)`) only when all of these hold:

1. the core is bound to an identity (the `bind` above, also optimistic);
2. that identity is not `removed`;
3. the entry is one an outsider may write: a new ticket of kind `issue` they created, or
   an amendment to their own issue;
4. they are under a per-identity cap (counted in the view, so every peer agrees).

Anything else is not acknowledged and never reaches the view. Autobase's own README
warns that optimistic blocks must verify themselves in `apply`; the four checks are
that verification.

**Telling outsiders from members at the door:** the room id is today's invite and must
stay a member invite. An outsider invite carries the swarm topic and the log key but not
the room id; `join-log` from then on carries a proof of the room id (an HMAC of the
writer key under it), so a member only admits a joiner who could produce one. An
outsider invite can be posted publicly; a member invite stays a secret, as now.

**What `issue` is:** a ticket kind, marked as from outside wherever it is shown, with
no steps an outsider can own. Members triage it into a bug, plan or task.

**What outsiders can see — all of it.** Every peer holds the whole log, so "read
everything" is literal:

- every message between members (`msg` entries) and every review's why;
- tickets behind `visibleTo` gates — that gate hides them from the screen, not from
  the copy. A room with outsiders has no private parts.
- Attachments and transcripts are not on the log; their holders hand them out on
  request. Holders should refuse `fetch-attachment` and not offer transcripts to
  outsiders.

That makes an outsider room a public room. The likely shape is a separate room per
community, beside the team's own, rather than outsiders in the team's room.

**Abuse:** any holder of an outsider invite can append. Unacknowledged blocks still
cost storage on whoever replicates them. The cap bounds what applies; `removed` stops
acknowledgement; dropping their connections (hyperswarm's `firewall`) stops the storage.

## Removing someone

Two levels, and only the second is removal in the sense a person means.

**Off the log.** An admin writes `role { removed }`. `apply` removes their writer cores
and refuses their later entries; members drop their envelopes and refuse their
fetches. What this does not do: take back what they already hold, or stop them reading
new entries. They keep the log key, and Corestore replicates whatever is asked of it on
any connection — and one connection carries every room two people share, so it cannot
simply be dropped.

**A new room without them.** This is how Holepunch describes it for Pear: everyone
agrees to start a new chat without that person. In this design:

1. An admin starts a fresh log and a fresh room id (new topic), and copies the room's
   state into it as its first entries: tickets, reviews, members, the name. Message
   history can be copied or left as the old log, read-only.
2. Each remaining member is told where it moved with a `moved` entry on the **old**
   log, sealed per member to their identity key (`crypto_box_seal`), so offline members
   find it when they return and the removed person reads only that the room moved.
3. A member's client follows the pointer: opens the new room, drops the old one from
   the rail, keeps the old log for history.

No agreement is needed for this to hold: the removed person never learns the new room
id or log key, so there is nothing to enforce. What can never be undone is what they
already have.

Encryption at rest (`encryptionKey` on Autobase) is not needed for this; a log key
nobody leaked is already unreadable. It matters later if blind seeders (always-on peers
that hold the log for others) are added.

## Recommendation

| Step | What | Depends on | Visible |
| --- | --- | --- | --- |
| 1 | Bind writer cores to identities; move who-may-change checks into `apply` | — | no |
| 2 | Roles: `admin`, `member`, `removed`; promote, demote, remove off the log | 1 | settings |
| 3 | Move a room without someone | 2 (who may) | room menu |
| 4 | Outsider invite, `issue` kind, optimistic appends | 1, 2 | new room kind |

Take step 1 whatever is decided about the rest: it closes forging between members, and
none of the tiers can be enforced without it. Step 3 is the one people will need first —
removing someone is a safety feature, outsiders are a growth feature. Step 4 is the most
new code and should start with a spike: collagen has never used Autobase's optimistic
path, and how an outsider's core reaches members (wakeup hints) needs
testing under the dev harness before anything is built on it.

## Open questions

- **Who holds the power.** The recommendation is admins, creator first. The
  alternatives: creator only (nothing changes once they are gone), or every member (one
  member can remove all the others — though today one member can already trash the
  room).
- **Can an outsider talk back?** Comment on their own issue, or reply to a member on it.
  The cap and the kind check stay the same either way.
- **The bare room id.** Kept as the member invite here. Making it the outsider invite
  and adding a member secret is cleaner, but changes what every invite shared so far
  means.
- **History in a moved room.** Copy messages, or leave them on the old log.
