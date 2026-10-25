---
name: steering
description: Use when adding or changing anything where collagen acts OUTSIDE collagen on the person's behalf — on the repo host (posting a review or comment, merging), in an AI conversation (starting one, resuming it, delivering into it), through any CLI or service in their name. Every such kind of action is a steering choice the person makes: it gets its own steering setting under the master level, off until they turn it up, and says plainly whose account it uses.
---

# Steering

Collagen may one day act for the person — answer in their conversations,
run the loop between their AIs, merge their pull requests — but only as far
as they allow. What collagen does inside itself (the room, the log, its own
pages) is the person's own tool at work. What it does **outside**, in their
name, is a choice they make: their repo host, their AI conversations, any
service reached with their account. Doing that unasked is what makes an app
feel like spyware. So every new kind of outside action comes with a steering
setting, the same way every person action comes with an MCP tool (AGENTS.md).

## The rules

1. **A new kind of outside action is a new steering setting.** One setting
   per *kind* of action, not per service: "the repo host" covers GitHub today
   and any host added later; "delivering into your conversations" covers
   Claude Code and Codex alike. If the person is fine with it in one context,
   they are fine with it in all.
2. **It sits under the master level.** The master (`lib/steering.ts`: ask
   first, act then tell, just do it) is the default every setting follows
   until the person sets that one. Levels underneath are the proposal
   "Steering levels per setting, under a master" (9deb4e5a); until they
   exist, add the new kind to that proposal's list and ship it behind the
   master level — never behind nothing.
3. **Off until the person turns it up.** The asking end is the default;
   autonomy is opted into. A setting nobody has chosen is told apart from a
   chosen "ask first", so collagen can ask for it the first time it matters.
4. **Say whose account, and through what.** Wherever collagen acts outside
   for the person, it says so: in their name, through their own `gh`, their
   own Claude Code — and at which steering level.
5. **A person can set it, and so can their agent.** The setting is in the
   settings page and has its tool (`set-steering`), with the same rules.
6. **The room is still their word.** No level lets collagen say something in
   the room for the person — a message, a take, a settle, a close — without
   them. Steering is about the work outside.
7. **Kept on their machine.** A steering level is a personal choice, stored
   locally, never replicated to the room.

## Bugs this would have caught

- Posting a review and its comments to GitHub in the person's name, with no
  setting at all — only a line on the review page saying so.
- The merge-for-you setting living apart from steering, as its own switch.

## Checklist

- [ ] Does this change make collagen act outside itself, in the person's name? Then:
- [ ] Its kind of action has a steering setting (or is added to proposal 9deb4e5a and gated by the master level).
- [ ] The default is the asking end; nothing outside happens before the person allows it.
- [ ] It says whose account it uses and at which level.
- [ ] The setting has its MCP tool, with the same rules.
