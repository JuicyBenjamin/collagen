---
name: one-moment
description: Use when a screen, page or tool call shows state that can move while it is on screen — a review's branch and its commit, a live list (messages, tickets, outbox), a language server still indexing, a cached answer. Everything shown together must come from one moment, and a later read must name that moment rather than ask for "now".
---

# One moment

A page is drawn from state at one moment; the branch, the log and the
language server keep moving. Most "timing" findings in review were a second
read that silently asked for *now* instead of *the moment already on
screen* — so two halves of one view disagreed.

## The rules

1. **A follow-up read names the moment it belongs to.** The review page's
   data carries the commit its diff was read at; the whole file, what moved
   since a file was viewed, hovers and peeks all pass that commit and read
   exactly it. Never resolve "the branch" again on the server.
2. **Refuse a moment you cannot serve; never substitute.** A commit the clone
   lacks is an error the page shows ("not in your clone"), not a quiet swap
   for the tip.
3. **Cache by the moment too.** A cache keyed by file and position must also
   key by commit, or an answer about the new code is served for the old.
4. **Live lists follow what the reader chose.** Following the newest is a
   default, not a lock: once the reader selects, opens or reads something,
   hold it until they navigate away (opened details pin the cursor; a
   message arriving does not take it).
5. **Partial is not final.** An answer given while still indexing says so on
   screen and can be asked again; only a final answer is cached.
6. **A live stream re-yields current state.** On reconnect a live function
   starts again from now; send a state token, not a count, so a change made
   while away is not lost (`reviewChanges`).
7. **Tests advance the world between the reads.** A regression for a race
   loads the page's moment, moves the branch (or sends the message), then
   asks the follow-up and checks it is of the first moment. In e2e, wait for
   the condition (`wait_until`), never a fixed sleep.

## Bugs this would have caught

- Whole file read the branch's tip while its added-line marks came from the
  older diff: after a push, the wrong lines were marked.
- "Since you viewed" diffed to the tip but was placed against older hunks.
- Hovers on the pinned file answered about the newer code.
- An arriving message took the cursor from the message being read.
- Partial language-server answers were cached and shown as final.

## Checklist

- [ ] Every follow-up call carries the moment (commit, token, id) of what is shown.
- [ ] The server validates that moment and uses exactly it; a missing one is refused.
- [ ] Caches key by the moment.
- [ ] A test moves the world between the first read and the follow-up.
- [ ] Live lists: what the reader picked stays picked when new rows arrive.
