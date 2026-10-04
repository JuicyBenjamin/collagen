# Project skills

What this project's code reviews keep finding, written down once so an agent
applies it while it builds — not after a reviewer catches it again. Each
folder is one skill: a `SKILL.md` with a `name`, a `description` saying when
it applies, then the rule, the bugs it would have caught, and a checklist.

The format is the open Agent Skills one, so the same files serve every agent.
They live here and nowhere else; each agent reads them through a symlink in
the place it looks:

| Agent | Looks in | Link |
| --- | --- | --- |
| Claude Code | `.claude/skills/` | `.claude/skills -> ../skills` |
| Codex | `.agents/skills/` | `.agents/skills -> ../skills` |

Another agent: add its link beside these, pointing at `skills/`. Never copy a
skill into an agent's folder — edit it here.

| Skill | Use it when |
| --- | --- |
| [replicated-merges](replicated-merges/SKILL.md) | changing anything peers write and merge: tickets, reviews, epics, ids, clocks |
| [one-moment](one-moment/SKILL.md) | a screen or call reads state that can move while it is shown: a branch, a live list, an index |
| [offline-and-delivery](offline-and-delivery/SKILL.md) | sending, receiving or waking anyone: outbox, transcripts, steps, readiness |
| [who-sees-what](who-sees-what/SKILL.md) | showing or explaining tickets to a person or an agent; filtering anything out |
| [tui-layout](tui-layout/SKILL.md) | laying out, sizing or scrolling anything in the OpenTUI app |
| [repo-hosts](repo-hosts/SKILL.md) | anything touching where code is hosted: pull requests, sign-in, links, refs, who wrote it |

When a review finds something none of these cover, and it could come back,
add it to the skill it belongs to (or a new one) in the same change.
