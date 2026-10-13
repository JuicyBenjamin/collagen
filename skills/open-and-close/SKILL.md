---
name: open-and-close
description: Use when anything on the review page (review-web) opens, closes, expands, collapses, appears or goes away — a why folding open, a file folding to its header, a popover, a panel, a row added to or taken from a list. It comes in and goes out animated, never in one frame.
---

# Open and close, animated

On the review page nothing pops. What opens grows in; what closes shrinks
out; what comes after it slides instead of jumping. A reader keeps their
place because they see where things went.

## The rule

- **Both ways.** Every expand has an enter and every collapse an exit. An
  exit that removes the element at once is the common miss: keep it placed
  until its exit has run, then take it away.
- **Motion, through the helpers.** `fold.ts` has them: `enter(el)` on the
  element as it is placed (its `ref`), `await leave(el)` before it is taken
  out. Height and opacity, about a fifth of a second, the shared ease. A
  shape they do not cover (a panel sliding across, a list reordering) uses
  Motion's `animate` the same way, beside them.
- **Two states when it closes.** What the reader asked (`open`) and what is
  still placed (`shown`): `open` flips at once, so the control answers;
  `shown` goes false after `leave`, and only if the reader has not opened
  it again meanwhile.
- **Padding on an inner box.** The animated box has no padding or margin of
  its own, or it cannot reach zero height.
- **It always ends.** A tab out of sight runs no frames, so an animation
  can stall half way; the helpers settle it once its time is up, open or
  closed. Awaiting Motion's own promise alone left a why shut at zero
  height.
- **None when asked for less.** `prefers-reduced-motion: reduce` skips the
  animation (the helpers do); the open and close still happen.
- **First paint is not an enter.** What is already open when the page loads
  just shows; only what the reader opens animates.

The TUI is exempt: a terminal redraws in steps.

## Bugs this would have caught

- The merge history's why folded open and shut in one frame, and the rows
  under it jumped.
- Opened in a tab with no frames, that why stayed at zero height.

## Checklist

- [ ] Does what opens have an enter, and what closes an exit?
- [ ] Is it still placed while its exit runs?
- [ ] Reopening during the exit leaves it open?
- [ ] Reduced motion: still opens and closes, without animating?
