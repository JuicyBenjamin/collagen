---
name: compound-components
description: Use when a component in collagen's review page grows props that only let one caller look different (a variant, a flag for one place), when a component needs named parts a caller composes, or when giving a component its placeholder (Foo.Skeleton). Parts exported as one namespace; the component regulates design, the caller owns arrangement.
---

# Compound components

When a component starts taking props that exist only so one caller can look
different, split it into parts instead of adding the prop.

## The rule

- **Parts as one namespace.** `Foo` is the component; its parts hang on it:
  `Foo.Skeleton`, `Foo.Head`, `Foo.Body`. Callers compose
  `<Foo.Head>…</Foo.Head>`; they import `Foo` alone.
- **Every part that loads has `.Skeleton`.** It is the part's own markup
  with its words masked, so it is the size of what replaces it. A page's
  placeholder is its parts' skeletons composed (`Page.Skeleton`), never a
  separate drawing of the page.
- **The component regulates design; the caller owns arrangement.** Parts
  carry spacing, borders, type and their CSS classes. Which parts appear,
  in what order, with what inside, is the caller's.
- **State is a prop named in the design's words,** with its quiet state
  named too: `tone: "neutral" | "accent" | "warn"`, not `isWarn`, then
  `isError`.
- **Cross-part behaviour lives in context, never in the caller.** Open,
  disabled, the data a part reads: the root owns them, the parts read them,
  so a caller cannot build a broken instance.

## Checklist

- [ ] Is a new prop only there for one caller's look? Make a part.
- [ ] Does each loading part have a `.Skeleton` built from its own markup?
- [ ] Can a caller compose a broken instance? Move that state into context.
