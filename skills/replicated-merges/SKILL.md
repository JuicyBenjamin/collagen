---
name: replicated-merges
description: Use when writing or changing anything peers write and merge in collagen — ticket, review, epic or step records, mergeTicket/mergeReview, operation ids, structureAt or other clocks, close/reopen turns, or protocol changes. Every peer must reach the same result whatever order copies arrive in.
---

# Replicated merges

Every record in a room is written by peers who are often offline, and copies
arrive in any order, any number of times. A merge is only correct if **every
peer ends with the same value however the copies were grouped and ordered.**
Most "consolidation" findings in review were a merge that was right for the
order the author tested and wrong for another.

## The rules

1. **Merges are commutative, associative and idempotent.** `merge(a, b)` =
   `merge(b, a)`; `merge(merge(a, b), c)` = `merge(a, merge(b, c))`;
   `merge(a, a)` = `a`. Prove it with a test that merges three copies in every
   order and grouping (see `epic.test.ts`, "merges the same however copies are
   grouped").
2. **Pick a whole revision; never stitch one together.** On a tie, choose one
   copy by a stable order over the whole value, then take its fields. Taking
   field A from one copy and field B from another makes a revision nobody
   wrote, and the result then depends on grouping (the title tie bug).
3. **Ids are random, never derived from who and when.** `opId()` is a
   `randomUUID`. A writer prefix plus a millisecond collides when one person
   does two things in one millisecond, and the merge then depends on arrival.
4. **Order by what was seen, not by the clock.** Wall clocks disagree between
   machines. When state depends on order (close vs reopen of an epic), record
   what the writer had seen (`knows`) and decide causally; pick the reason you
   show by the same rule that decided the state, never "the latest by time".
5. **Only the author advances the author's clock.** `structureAt` moves only
   on an author revision; a peer's take or settle moves `updatedAt`. A stale
   copy must never revert the author's latest decision.
6. **Grow-only where possible.** Moves, turns, steps: union sets keyed by a
   unique id; "removal" is another entry (an exclusion, a reopen), not a delete.
7. **A new field is a protocol change.** Add its default in `migrate.ts` and
   bump `PROTOCOL_VERSION`, or an older peer rewriting the record drops it.
   (A field only its author ever writes, on a record older peers never write
   back, can skip the bump — say why in the review.)
8. **A field already on the log never becomes required.** Records written
   before it existed are in every peer's log; a build that cannot decode a row
   *evicts it for the whole room* (`evictStale`). Add a field as
   `Schema.optional` in the stored schema, default it where it is read, and
   require it only at the tool's input. Test that a record without it decodes.

## Bugs this would have caught

- Membership and turn ids built from writer + millisecond collided; merges
  depended on arrival order.
- A title tie borrowed the title from the other copy: `merge(merge(A,B),C)`
  and `merge(A,merge(B,C))` disagreed.
- An epic's reopen reason was chosen by wall clock while closure was causal,
  so the shown reason was not the one that decided it.
- A review unit's `what` was added as required: the author's own build could
  no longer read its earlier reviews and evicted them for everyone, until
  `restoreOwn` put them back from its history.

## Checklist

- [ ] A test merges every permutation and grouping of three conflicting copies.
- [ ] Ties are broken by a total order over the whole record.
- [ ] New ids come from `opId()` (or another random UUID).
- [ ] Nothing ordered by `Date.now()` across peers; causal where it matters.
- [ ] Schema change: migration default + `PROTOCOL_VERSION` bump, or a stated reason not to.
- [ ] A new field on a stored record is optional there; a record without it still decodes (tested).
