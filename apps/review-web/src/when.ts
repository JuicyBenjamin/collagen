// Times reach the page as instants — epoch milliseconds or ISO strings in UTC
// — and become a date and a time only here, at the last step: in the
// reader's own time zone and language, through Temporal, never an
// all-numeric date that reads one way in Denmark and another in the US
// (skills/dates-and-times). Every date on the page goes through this module.

/** How a date is shown: the month in words, the year only when it is not this one. */
const DAY: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
const TIME: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };

/** An instant as the reader's own date (and time), in their zone. A browser
 *  without Temporal formats the same instant through Intl with the same
 *  options, which is what Temporal's own formatting does. */
const shown = (instant: number, withTime: boolean): string => {
  if (typeof Temporal === "undefined") {
    const thisYear = new Date(instant).getFullYear() === new Date().getFullYear();
    return new Intl.DateTimeFormat(undefined, { ...DAY, ...(thisYear ? {} : { year: "numeric" }), ...(withTime ? TIME : {}) }).format(instant);
  }
  const zone = Temporal.Now.timeZoneId();
  const at = Temporal.Instant.fromEpochMilliseconds(instant).toZonedDateTimeISO(zone);
  const thisYear = at.year === Temporal.Now.zonedDateTimeISO(zone).year;
  return at.toLocaleString(undefined, { ...DAY, ...(thisYear ? {} : { year: "numeric" }), ...(withTime ? TIME : {}) });
};

/** The reader's date for an instant: "3 Oct", "3 Oct 2025". */
export const dateOf = (instant: number): string => shown(instant, false);

/** The reader's date and time for an instant: "3 Oct, 14:05". */
export const dateTimeOf = (instant: number): string => shown(instant, true);

/** "just now", "4 min ago", "3 h ago", then the reader's date — from `now`. */
export const ago = (instant: number, now: number): string => {
  const mins = Math.round((now - instant) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  return dateOf(instant);
};
