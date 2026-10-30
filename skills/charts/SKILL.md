---
name: charts
description: Use when adding or changing a chart in collagen — the audit page, any TanStack Charts panel, a tooltip, a chart's colours or its title. Every chart answers one question a person has; its hover shows only what the chart does not; one calm palette.
---

# Charts

A chart is there to answer a question, not to show that data exists. The
person has had to ask "what is this trying to show?" of chart after chart.
Ask it yourself first.

## The rules

1. **One question per chart, said in its subtitle.** Before choosing a mark,
   write the question ("is collagen what fills sessions up?"). If you cannot,
   the chart should not be there. The title is short; the subtitle is the
   question or what the number is of.
2. **A number needs what it is a part of.** Collagen's tokens at a compaction
   mean nothing without the window they sat in; a share needs its whole.
   Show the ratio, and say what the whole is.
3. **Readable beats clever.** A sorted bar with its number at the end reads
   in a second; a box plot, sunburst or two-ring donut with many parts does
   not. Use a pie or donut only for a few parts (four at most, the rest as
   "Other"), and one whole per chart — two wholes are two charts.
4. **The hover adds; it never repeats.** If the name and number are already
   on the chart, hovering must show something that is not (the tools behind
   a kind, how often a definition was called, the calls behind a tile) — or
   there is no tooltip. A tooltip's title and value sit on one left edge.
5. **One palette, colour only where it means something.** One series is one
   colour (`--viz-1`). How much is one blue ramp. Context is grey
   (`--viz-context`). The four categorical slots (`--viz-1`…`--viz-4`) only
   where parts must be told apart, in that order. Never theme status colours
   or ticket-kind colours for series. Any new categorical colour is checked
   with the dataviz validator on both surfaces.
6. **Never show a guess as a fact.** A harness's dollar estimate is not a
   cost; show the tokens, which are counted.
7. **The period means the period.** Every number on a page with a period
   counts only that period, including what a session read before it.
8. **Size the panel to the chart.** A small chart in a big panel looks lost:
   size the panel to its content and let neighbours take the rest.

## Found in review

- Tooltips that said "Filing, 638 calls" over a bar labelled Filing 638.
- A box plot of tokens a call and a sunburst of 64 tool definitions nobody
  could read; ranked bars said it at once.
- Harnesses and models in one two-ring donut.
- Compactions plotted as collagen's raw tokens, with no window to compare.
- "Collagen's share" with no word on what it was a share of.
- Nine theme colours on one page; a dollar figure that was an estimate.

## Checklist

- [ ] The subtitle states the question or the whole the number is part of.
- [ ] Every hover shows something not already printed, or there is none.
- [ ] Colours from the `--viz-*` palette only; one series is one colour.
- [ ] Every number counts only the page's period.
- [ ] No estimate shown as a fact.
- [ ] Looked at it, hovered it, and measured its edges (skill: alignment).
