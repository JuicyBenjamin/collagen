---
name: alignment
description: Use when building or changing anything a person sees in collagen — the review page, the audit and investigation pages, charts and their tooltips, the TUI. Things that sit together share an edge; check it by measuring before calling the work done, never wait to be told.
---

# Alignment

Things that belong together line up: on one left edge, one baseline, one
column. A person sees a misaligned edge before they read a word, and has
had to point it out again and again. Check it yourself, every time, before
you say a screen is done.

## The rules

1. **Text that stacks shares a left edge.** A title and its subtitle, a
   tooltip's title and its value, a label and the number under it. Nothing
   is indented unless the indent means "this belongs to the line above".
2. **Numbers in a column align right** (tabular figures); words align left.
   A lone number under a title is not a column: it aligns with the title.
3. **Side by side means same height and same top.** Panels in a row are as
   tall as each other; their titles sit on one line; their charts start at
   the same height when their headers match.
4. **A chart's plot shares its panel's edges.** The axis labels sit inside
   the panel's padding, not past it; a chart that leaves a gap the panel's
   other content does not is wrong.
5. **Library defaults are not exempt.** A chart library's tooltip, legend or
   axis brings its own grid and padding (TanStack's tooltip row keeps an
   empty swatch and label column, pushing a lone value right). Override it.
6. **Legends and keys sit on the edge of what they explain**, swatches in one
   column, names in the next, counts right-aligned in the last.

## How to check

Look, then measure. A screenshot shows the obvious; a zoom on each tooltip,
legend and header shows the rest. When in doubt, read the edges:

```js
[...document.querySelectorAll(".audit-panel h2, .audit-panel .audit-sub")].map((element) =>
  Math.round(element.getBoundingClientRect().left),
);
```

Every edge that should match, does — to the pixel.

## Found in review

- An audit tooltip put "33,555 tokens" right of its date "2 Oct, 15:19":
  the library's row grid kept an empty label column.
- Panels side by side of different heights, their charts starting at
  different lines.
- Chips and buttons sized and aligned differently in one row.

## Checklist

- [ ] Every stacked title, subtitle, value and label shares its left edge.
- [ ] Number columns right-aligned with tabular figures.
- [ ] Panels in a row: same height, titles on one line.
- [ ] Tooltips, legends and axes checked by zoom, not assumed.
- [ ] Edges measured where a screenshot cannot settle it.
