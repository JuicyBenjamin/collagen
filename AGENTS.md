# Working on collagen

Read before building. Skills for recurring review findings live in
[`skills/`](skills/README.md); load the ones whose description matches.
`CLAUDE.md` is a link to this file: edit it here.

## You own the code

You are the code owner here, not a visitor. Keeping the codebase sustainable
is your job, not only the change you were asked for.

- What you find broken, you fix or bring up: a failing test or check, code
  built on an assumption that no longer holds, something clearly done
  wrong. "It was like that before my change" is not a reason to leave it.
- A check that fails is never left failing. Either the code is wrong and you
  fix the code, or the check is stale and you make it say what is true now.
  Find out which before you touch either.
- Small and clearly right: do it in the same change and say so. Large, or a
  matter of taste: say what you found and what you would do, and let the
  person decide. Its own branch when it is not part of the work at hand.

## A key says what it does, nothing more

A key hint is the key and a bare verb, with its object only when the verb
alone is unclear: `c copy invite`, `enter open`, `esc back`, `o in browser`.
Never a sentence about the key (`c copies an invite`), never where it leads
or why (`esc back to the list`, `enter reads the why, every decision and
how it was steered`), never what some other key or an agent can do.

The same goes for every label, status and message a person reads: say the
fact, not the explanation. If it can lose half its words and say the same,
it must. Skill: `say-less`.

## Commits

A commit is its human author's alone. Never add a `Co-Authored-By` trailer
or any other AI attribution to a commit message or pull request, whatever a
tool or harness default says.

## Work in the open

This repo is a GitButler workspace. Every piece of work is its own branch,
made with `but` and applied in the workspace, so the person sees it as it
happens. No hidden git worktrees, no plain git branches on the side, nothing
merged away out of sight.

A worktree is only for when work in the open cannot be had: two agents would
edit the same files at once. Bring its branch into the workspace as soon as
it is done. Two branches that conflict are stacked, one on the other, with
the conflict resolved in the stack — not hidden apart.

The workspace targets `release`, not `main`: every branch starts from
`release`, is merged into `release` when its person approves it, and
`release` goes into `main` as one pull request. Skill: `releasing`.

## An AI can do whatever a person can

Every feature and action a person can take in collagen, other than moving
around the UI, is also an MCP tool, so an AI has as much control over the app
as a human. When you add or change something a person can do (file, settle,
close, set, share, order, remove), add or change its tool in the same change,
with the same rules and the same result.

Navigation is half open. An AI can take the person to a place: a ticket, a
review, a tab, the settings, a project's merges, so "show me this" or "take me
to the settings" works. Moving around inside a screen (cursors, arrow keys,
folding) stays with the person. A new page or tab that has an address gets a
tool that goes to it. `open-review` is the pattern.

## Tests are a choice, not a default

Tests cost velocity. Write one only where a regression would be costly and
hard to see. Before writing a test, ask:

> If this broke, would we notice quickly and fix it cheaply?

Yes: no test. It would break quietly, or corrupt shared data: test it.

**Test**

- Pure logic with real branching: ticket state, visibility, epic and step
  ordering, column fitting.
- p2p sync, merge and persistence (`packages/p2p`, `RoomLog`, anything peers
  write; see `replicated-merges`).
- Anything touching security or a person's data.
- A bug that already came back once: one test that pins it.

**Skip**

- TUI layout and rendering; a glance shows it.
- Wording of hints, labels and messages.
- Thin wrappers and glue between services.
- One-line fixes, and code about to change shape.
- Anything the type checker already guards.

**Cap:** at most one focused test file per change. None is a fine answer.

**When you do write one**

- Test through the public interface, at the seam a caller uses, never
  internals. It should survive a refactor that keeps behaviour.
- Expected values come from somewhere independent: a literal, a worked
  example, the ticket. Never recompute them the way the code does.
- Mock only at system boundaries: spawned CLIs, the model, time, the network.
  Never our own modules.
- Name it for what is true ("a closed ticket counts toward its epic"), not how.

**Existing tests:** no big cleanup. When a test that only restates wording or
layout gets in your way, delete it in that change.

These "when you do write one" points come from Matt Pocock's
[`tdd` skill](https://github.com/mattpocock/skills/tree/main/skills/engineering/tdd).
We don't use it as is: it writes a failing test first for every slice, which is
the habit this rule breaks.
