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
2. **It sits under the master level.** The levels live in `lib/steering.ts`
   (stored as `SteeringLevels` in the p2p schema): a master, and a level per
   `SteeringKind` that follows it until set. A new kind of outside act is a
   new `SteeringKind` with its `KIND_LABEL`, or one of the existing kinds
   (`host`, `deliver`) when it is the same kind of act.
3. **The compiler holds the gate.** The act itself requires a permit in its
   Effect context (`HostAllowed`, `DeliverAllowed`, or a new one beside them),
   and only `allow(state, kind, cause, yes)` mints one: call it, handle
   `held`, and run the act with `withHost` / `withDeliver`. An act that skips
   steering does not type-check. Never mint a permit anywhere else.
4. **Not chosen means not done.** Until the person picks a level, the act
   does not happen outside, and each conversation is told once to ask them.
   "ask first" hands the question back to the agent whose call would have
   done it; the agent asks and calls again with their yes. Never ask through
   the TUI or the review page: questions go through the agent.
5. **Mine and others' apart.** Pass the right `Cause`: what the person or
   their own agents caused is `mine`; what another person caused (their
   message, their approval) is `others`, which never follows `mine`.
6. **Say whose account, and through what.** Wherever collagen acts outside
   for the person, it says so: in their name, through their own `gh`, their
   own Claude Code — and at which steering level.
7. **A person can set it, and so can their agent.** The setting is in the
   settings page and in `set-steering`, with the same rules.
8. **The room is still their word.** No level lets collagen say something in
   the room for the person — a message, a take, a settle, a close — without
   them. Steering is about the work outside.
9. **Kept on their machine.** A steering level is a personal choice, stored
   locally, never replicated to the room.

## Bugs this would have caught

- Posting a review and its comments to GitHub in the person's name, with no
  setting at all — only a line on the review page saying so.
- Merging for the person on someone else's approval with nothing but the
  merge-for-you switch: it now also waits on the repo-host level, for others.
- Resuming an adopted conversation on any message, adoption standing in for consent.

## Checklist

- [ ] Does this change make collagen act outside itself, in the person's name? Then:
- [ ] Its kind of action is a `SteeringKind` (new or existing), and the act requires its permit.
- [ ] It goes through `allow` with the right cause; held, it does nothing outside and says why.
- [ ] Nothing outside happens before the person chooses a level; ask first hands the question to the agent.
- [ ] It says whose account it uses and at which level.
- [ ] The setting has its MCP tool, with the same rules.
