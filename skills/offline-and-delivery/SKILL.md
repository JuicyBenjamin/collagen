---
name: offline-and-delivery
description: Use when sending, receiving or waking anyone in collagen — the outbox and Dispatch outcomes, transcripts and attachments, messages to peers, step readiness (actionableSteps, ticket summaries), notifications to agents. Peers are often offline; a send can fail; one readiness rule must decide who acts.
---

# Offline and delivery

Peers come and go. A send can be refused, the receiver can be offline, a
request can arrive while nobody can answer it. The "offline" findings in
review were all a place that assumed the happy path: it reported success it
did not have, dropped something it could not deliver yet, or decided who
should act by a second, drifting copy of the rule.

## The rules

1. **Record only what happened.** The outbox remembers a write only after
   Dispatch says it was done; a refused write leaves no row and its reason
   goes back to the agent. Never write "sent" before the outcome is known.
2. **Undelivered is pending, not done.** A request for someone offline (a
   transcript, a file) stays until it is actually delivered or explicitly
   declined; delivery failing is a reason to keep it, not to drop it.
3. **Words match outcomes.** A review asking for changes is a complete
   review, not a failure; say "changes asked". An outcome that failed starts
   with `failed:` and says what to do next.
4. **One readiness rule.** Who must act on a step is decided in one place
   (`actionableSteps` in p2p). The TUI, the agent nudges and the summaries
   read it — never reimplement it beside them, or they drift (an open review
   that woke its own author; an overview disagreeing with the agent).
5. **Nobody is woken by their own act.** Filing, revising or answering wakes
   the people it is for, not the person who did it.
6. **Test with someone away.** A delivery path gets an e2e step where the
   receiver is offline, then comes back, and the thing still arrives.

## Bugs this would have caught

- Failed sends were recorded as successful receipts.
- Failed transcript deliveries permanently discarded the request.
- A review with nobody asked woke its own author immediately.
- A reviewer asking for changes did not unblock the author.
- The ticket overview reimplemented readiness and disagreed with `actionableSteps`.

## Checklist

- [ ] Nothing is recorded as done before its outcome says so.
- [ ] Offline receiver: the request survives until delivered or declined.
- [ ] Readiness comes from `actionableSteps`, not a local copy.
- [ ] The actor is not woken by their own act.
- [ ] An e2e step covers the receiver being offline.
