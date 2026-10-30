---
name: component-design
description: Use when building or changing UI in collagen (the review page in apps/review-web, the TUI in apps/cli) — splitting a screen into components and deciding who owns what. More components instead of helpers or hooks; parents pass plain data, children own their rendering, visibility, local state, and on the review page their own placeholder and arrival. Also when a component is getting big, when a part loads on its own, or when data goes missing between components.
---

# Component design

A screen is read as a tree of parts, so the code is one: each part a
component that owns what it shows, how it waits, and how it comes and goes.
Nothing outside a part coordinates it.

## The rule

- **More components, not more helpers.** When a component grows, split it
  into children that each own their logic, handlers and effects inline. A
  few lines of derived state or a ternary stay in the component that uses
  them; a tiny helper used twice is written twice, not given a file.
- **Parents pass plain data; children own the rest.** The parent reads and
  orchestrates; the child decides what to show, whether to show anything
  (a child that can decide `null` from its props does), and its local
  state ("open", "show more"). Do not precompute a child's display model in
  the parent.
- **A part owns its own waiting** (review page). A component whose data is
  read knows the shape it will have: its placeholder is its own (`Foo.Skeleton`,
  next to `Foo`), and it wraps itself in `Arrives`, so it shows that
  placeholder until *its* data is in and then sweeps it away — as soon as it
  is ready, never held back for a slower part. A page is these parts
  composed; it does not gather everything and reveal it at once.
- **Every element comes and goes animated** (review page): what arrives
  with data, through `Arrives`; what a condition toggles, through `Appear`
  (enter and exit). See `open-and-close`.
- **Hooks and shared modules earn their place** only for real lifecycle
  (a subscription, a live server read, coordination two siblings both
  read). Colocate them with the components they serve.
- **DaisyUI on the review page's pages.** Its components (card, badge,
  list, progress, button…) on collagen's theme, each imported in
  `themes.css`; where the review page already has a pattern (its outline,
  its headings), reuse that rather than a DaisyUI default.
- **Colour carries meaning, or it is not there.** A verdict, a fit, a
  ticket's kind: yes. A grey box around text, a coloured bullet, a dot in an
  outline: no — if a reader cannot say why it is coloured, it goes.
- **Narrow props.** `count`, `pull`, `viewer`, not the parent's whole state.
  Missing data stays missing; the component that renders it handles
  `undefined`.

## Bugs this would have caught

- The review page's outline and code were swept in by one coordinator over
  the whole screen: everything waited for the slowest read, and parts with
  no placeholder flashed in under it.
- A host bar placeholder was taken away, then its part swept in from
  nothing: it appeared, vanished, appeared.
- `App.tsx` held the page, the header, the outline, the units and their
  why in one file of nearly 800 lines.

## Checklist

- [ ] Could this component be two? Is each child the owner of its rules?
- [ ] Does a part that waits on data carry its own placeholder and `Arrives`?
- [ ] Does it show the moment its own data is in?
- [ ] Is each toggled element in an `Appear`?
- [ ] Is it DaisyUI, and does every colour on it mean something?
