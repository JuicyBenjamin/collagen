---
name: names-say-what
description: Use when writing or changing any code in collagen — every parameter, variable, callback argument and destructured name says what it holds. No `t`, `p`, `q`, `i`, `res`, `ctx`; `ticket`, `project`, `query`, `index`, `response`, `context`. pnpm lint enforces it.
---

# Names say what they hold

A reader should understand a line at a glance. A one-letter name makes them
stop and work out what it is from where it came from; a word tells them.

## The rule

- **Name it for what it holds**, in the domain's words: `ticket`, `review`,
  `merge`, `project`, `peer`, `decision`, `page`. In a collection callback,
  the singular of the collection: `tickets.map((ticket) => …)`.
- **No one-letter names**, no two-letter ones that are not words (`pr`,
  `mb`), and no abbreviations (`res`, `ctx`, `msg`, `err`, `idx`, `fn`).
  `id`, `at`, `to`, `ok` are words and fine.
- **Loops count something**: `index`, or what it counts (`row`, `attempt`).
- **Caught errors are `error`.**
- **Destructuring renames**: a field kept short on the wire is renamed where
  it is bound — `const { ts: at } = entry`.
- **Fields of types you declare too**: `{ m: HostMerge; p: number }` reads
  as `best.m` everywhere it is used — `{ merge: HostMerge; at: number }`.
- **Allowed**: `_` and `_`-prefixed names for what is unused on purpose;
  `a` and `b` in a `.sort()` comparator; `ai`; and as a type's field `ts`
  and `op` (as the stored records name them) and `x`, `y`.
- **Stored data keeps its names.** A field already written to disk or synced
  to peers is not renamed: disable the rule on that line and say where it is
  stored (`-- stored on disk as \`n\``).

`pnpm lint` (oxlint, `lint/naming/no-shorthand-names.mjs`) fails on any of
them, in CI too.

## Checklist

- [ ] Could someone reading only this line say what each name holds?
- [ ] `pnpm lint` clean?
