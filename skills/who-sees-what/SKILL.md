---
name: who-sees-what
description: Use when showing, listing, counting or explaining tickets, epics, reviews or decisions to a person or an agent in collagen — TUI pages, the review page, get-tickets and other tool outputs, conflict and closure reasons, outbox text. Everything shown passes the same visibility gate, and nothing that should be shown is silently dropped.
---

# Who sees what

A ticket that waits on another (`after`) is its author's alone until it
opens; other gates may follow. Every surface that names tickets — a list, a
page, a tool's output, an explanation, a count — must apply the same gate.
The opposite mistake is as common: a grouping or filter that quietly drops
something the reader needed (a decision, a stale pointer).

## The rules

1. **One gate, everywhere.** Filter with `visibleTo(ticket, all, me)` before
   listing, opening, or naming a ticket — in TUI pages, in `get-tickets`, in
   `review-context`, and inside generated text.
2. **Explanations obey the gate too.** A reason or conflict message that
   embeds a title ("closed because X is unresolved") leaks it; say "a ticket
   you cannot see yet" or count it without naming it (`epicBecause` takes the
   reader).
3. **Counts may cover everything; names may not.** An epic's progress can
   count the whole room; its list shows only what this reader may see.
4. **Nothing vanishes silently.** When grouping or filtering, every item ends
   up somewhere visible: a decision with no matching change goes to
   "Decisions outside the diff"; a change no decision covers is marked; a
   pointer that matches nothing says the why may be older than the branch.
5. **Name things by their title, everywhere.** Lists show titles; so must tool
   outcomes, outbox rows and hints — store what was shown (`name`) next to
   any older field (`goal`) rather than re-deriving it differently.
6. **Check the inputs that decide what is shown.** A tool amending a ticket
   checks its kind; a headline is one line; the page's arguments are
   validated before use.

## Bugs this would have caught

- The epic page and agent listing showed children gated by `after`.
- Conflict explanations embedded the titles of tickets the reader could not see.
- Decisions whose pointers matched no change disappeared from the review page.
- Tool outcomes and the outbox named epics by goal after a rename.
- `ask-review` with a ticketId accepted ordinary task tickets.

## Checklist

- [ ] Every list, page and tool output filters through `visibleTo`.
- [ ] No reason or message names a ticket the reader cannot see.
- [ ] Every input item lands in some visible place; a test asserts the leftovers.
- [ ] Titles, not goals, wherever a thing is named.
