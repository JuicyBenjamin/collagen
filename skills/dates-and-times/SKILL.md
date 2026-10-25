---
name: dates-and-times
description: Use when writing or changing anything in collagen that stores, sends, compares or shows a date or a time — a ticket's or comment's timestamp, "3 h ago", a review's "You reviewed · …", log lines, the merges page, outbox rows, anything peers write with a time in it. Times are UTC everywhere; they become the person's own date and time only where they are shown, through Temporal.
---

# Dates and times

A time is one instant, the same for every peer. It only turns into a date
and a clock reading at the last step, on the screen of the person reading
it, in their time zone and their language. Reviews found dates shown as
`03/10/2026` — the third of October, or the tenth of March? — because the
machine's default formatting decided, not us.

## The rules

1. **Stored and sent as UTC.** On the log, in local state, over MCP and
   between peers a time is an instant: epoch milliseconds (`ts`,
   `updatedAt`) or an ISO string ending in `Z`. Never a local time, never a
   formatted date, never an offset that is not `Z`.
2. **Compared and computed as instants.** "Changed since", "the later of
   two", "3 h ago" work on instants (`Temporal.Instant`, or the epoch
   milliseconds themselves). Day boundaries ("today", "yesterday") are the
   reader's, so they are worked out in their zone (`Temporal.ZonedDateTime`),
   never by dividing milliseconds by a day.
3. **Shown through Temporal, in the reader's zone.** At display, one helper
   per app turns the instant into the reader's date and time:
   `Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(Temporal.Now.timeZoneId())`,
   then `toLocaleString` with explicit options (`dateStyle: "medium"`,
   `timeStyle: "short"`, or `month: "short", day: "numeric"`) — never an
   all-numeric date, never `toLocaleString()` without options.
4. **One helper, used everywhere.** The review page formats in
   `apps/review-web/src/when.ts` (`dateOf`, `dateTimeOf`, `ago`); the TUI in
   `apps/cli/src/lib/when.ts` (`dateTimeOf`). A screen never calls
   `new Date(...).toLocale…`, or shows `toISOString()` to a person, itself.
5. **Temporal where it is built in.** Node (the cli) and current browsers
   have it. A browser without it gets the same instant formatted through
   `Intl.DateTimeFormat` with the same options — what Temporal's own
   formatting does — inside the same helper, so callers never know and
   nothing extra is loaded.
6. **An agent reads UTC.** Tool outputs give ISO instants (`…Z`); the agent
   turns them into the person's time when it talks to them. Never a
   formatted local date in a tool result.

## Bugs this would have caught

- "You requested changes · 03/10/2026": `toLocaleDateString()` with no
  options, ambiguous between day-first and month-first readers.
- The outbox and messages pages printing `toLocaleString()`: the machine's
  locale and an all-numeric date.
- The TUI's transcripts and review pages showing a person a raw UTC stamp
  (`2026-10-25 14:03`), an hour or two off their own clock.

## Checklist

- [ ] Every time written or sent is epoch ms or an ISO string ending in `Z`.
- [ ] Comparisons and "ago" work on instants; day boundaries in the reader's zone.
- [ ] Display goes through the app's one helper, using Temporal and explicit options.
- [ ] No `toLocaleString()` / `toLocaleDateString()` without options anywhere.
- [ ] Tool outputs carry UTC instants.
