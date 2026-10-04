---
name: say-less
description: Use when writing any text a person sees in collagen — the review page, the TUI, banners, labels, hints, empty states, errors. Collagen exists to cut through noise: say the fact, not the explanation.
---

# Say less

AI is bloating everything; collagen is the tool that cuts through it and
leaves the signal. Every line a person reads must earn its place. Under-
explaining is the goal, not a risk.

## The rule

- **Say what it is, not why.** "Assumption-based review by Juicy" — not who
  does or does not use what, how it was built, what was read, or what to do.
- **One line beats a paragraph.** A banner is a label. A hint is a few words.
- **Don't guess at people.** Say what happened ("not filed by its author"),
  never a story about them ("does not use collagen").
- **Detail is one step away, not on the surface.** Sources, reasons and
  instructions live where a reader goes on purpose (the why panel, the docs,
  an agent's review-context) — not in what everyone sees.
- **Numbers that mean "you have something to do" stay**; counts that only
  describe go.

Agent-facing text (tool descriptions, outcomes) may explain more — agents
need instructions — but what an agent is told to tell the person is a line.

## Bugs this would have caught

- The assumed-review banner was three lines: who does not use collagen, how
  the AI inferred it, every source read, and what to do — and it was wrong
  about the person. It is now "Assumption-based review by Juicy · 0 of 5 checked".

## Checklist

- [ ] Can this text lose half its words and say the same?
- [ ] Does it explain something the reader did not ask about?
- [ ] Does it claim something about a person that is only a guess?
