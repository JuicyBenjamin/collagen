---
name: tui-layout
description: Use when laying out, sizing, aligning or scrolling anything in collagen's OpenTUI (React) terminal app — columns, truncation, wide characters, scrolling lists, focus between sections. Covers OpenTUI's quirks that reviews have hit.
---

# TUI layout (OpenTUI)

## The rules

1. **Measure in terminal cells, not string length.** `lib/columns.cells`
   (string-width): `界` is two cells, a combining accent none. Never size a
   column with `.length`.
2. **Bound every column by the pane.** A column as wide as its widest entry
   must still fit the measured pane (`fitColumns`): titles keep their room
   first, the rest is cut at its end with `clip`, never in the middle.
3. **`flexBasis`, not a numeric `width`, for anything that must shrink.**
   Setting a numeric `width` after mount turns `flexShrink` off.
4. **Every scrolling list uses `FollowScroll`.** It moves only when the
   cursor's row would leave by the bottom or the top, by exactly enough;
   rows are found by `id`. Don't window rows by hand or call OpenTUI's
   `scrollChildIntoView` (it measures against a drifting viewport).
5. **Chain onto OpenTUI's handlers; never replace them.** The scrollbox
   re-measures its range in its content and viewport `onSizeChange`;
   overwriting them froze scrolling. Wrap: call the old one, then yours.
6. **Glyphs must be one cell everywhere.** Prefer ones narrow in every
   terminal (Unicode 16 made `☰` two wide); ambiguous-width box drawing is
   fine in Western terminals.
7. **Verify on a real screen.** Capture with the pyte harness at a small and
   a normal size, step through the interaction, and check positions frame by
   frame — a passing build proves nothing about a layout.

## Bugs this would have caught

- The info column took its widest note and squeezed every title in a narrow pane.
- Titles of wide characters got half the room they needed.
- The ticket list scrolled before the cursor reached the bottom; the outbox
  re-centred on every keypress.
- An unfolded message taller than the list flipped between top and bottom.

## Checklist

- [ ] Widths via `cells`, bounded by the measured pane.
- [ ] Shrinkable boxes use `flexBasis`.
- [ ] Scrolling via `FollowScroll`; rows carry ids.
- [ ] Captured and stepped through at two sizes.
