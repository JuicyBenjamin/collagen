---
name: open-and-close
description: Use when anything on the review page (review-web) opens, closes, expands, collapses, appears, arrives with data or goes away — a why folding open, a file folding to its header, a popover, a panel, a row added to or taken from a list, a part read from the server. It comes in and goes out animated, never in one frame.
---

# Open and close, animated

On the review page nothing pops. What opens grows in; what closes shrinks
out; what comes after it slides instead of jumping. A reader keeps their
place because they see where things went.

## The rule

- **Every element, through two primitives.** What a condition shows or
  hides goes in `Appear` (`components/Appear.tsx`): it enters as it is
  placed and leaves before it is taken away. What waits on data goes in
  `Arrives` (`components/Arrives.tsx`) with its own `.Skeleton`: the
  placeholder stands until that part's data is in, then lies over the part
  and is swept away, top left to bottom right. The placeholder never goes
  first: a part never shows a blank frame between its placeholder and
  itself.
- **Each part when it is ready.** A part arrives on its own data, never
  held for another's; nothing sweeps the page as a whole.
- **Both ways.** Every expand has an enter and every collapse an exit. An
  exit that removes the element at once is the common miss: keep it placed
  until its exit has run, then take it away.
- **Motion, through the helpers.** `fold.ts` has them: `enter(el)` on the
  element as it is placed (its `ref`), `await leave(el)` before it is taken
  out. Height and opacity, about a fifth of a second, the shared ease. A
  shape they do not cover (a panel sliding across, a list reordering) uses
  Motion's `animate` the same way, beside them. Something moving from one
  place to another (the review's pill, from the header to the corner) is
  one view transition: the same `view-transition-name` on each place, only
  one holding it at a time, the switch inside `startViewTransition`
  (`floating.ts`).
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
  just shows, and a part whose data is already in (kept from the last
  visit) shows without a placeholder or a sweep.

The TUI is exempt: a terminal redraws in steps.

## Bugs this would have caught

- The merge history's why folded open and shut in one frame, and the rows
  under it jumped.
- Opened in a tab with no frames, that why stayed at zero height.
- A host bar placeholder was taken away and its part swept in from nothing:
  it appeared, vanished, appeared.
- One sweep over the whole screen waited for the slowest read, and parts
  with no placeholder flashed in.
- The host's section had no placeholder: it opened in when the host
  answered and pushed the code down, then closed and opened again while
  the host was asked a second time. A part that waits on a read has a
  placeholder, and a read asked again keeps its last answer meanwhile.
- On a first visit the host's placeholder assumed a pull request; a review
  with none lost it on arrival and the code jumped up 99px. A placeholder
  for a part that may not come stands only on grounds: what the head
  already says, or what the part was last visit (`kept`).
- The tabs over the code came with the diff and had no placeholder, so a
  review with tabs moved 20px as it arrived. A row whose contents depend on
  data is always there (the code's tab alone when nothing else), its
  placeholder masking what it held last time.
- The sweep's placeholder, laid over the part, dropped the top margin of
  every part in it, not just the first: once the tabs led the diff's
  placeholder, the units under them stood 48px too high and jumped as the
  sweep ran. Only the first part's margin folds through.
- The stack row came with the host's answer and opened in, pushing the page
  down 31px. What the room already knows (its own reviews) comes with the
  head, so the row stands from the first paint; the host only adds to it.

## Checklist

- [ ] Is every toggled element in `Appear`, every loading part in `Arrives`?
- [ ] Does what opens have an enter, and what closes an exit?
- [ ] Is it still placed while its exit runs?
- [ ] Reopening during the exit leaves it open?
- [ ] Reduced motion: still opens and closes, without animating?
- [ ] Measured, not guessed: on a first visit (storage cleared) and a
      return visit, wide and narrow, the page's layout shifts sum to 0 — a
      `PerformanceObserver` on `layout-shift` with `buffered: true`, read
      once the page has settled, names any part that moved.
