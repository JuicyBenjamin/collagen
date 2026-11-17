// Times are instants everywhere — epoch milliseconds, ISO strings in UTC —
// and become a date and a time only on screen, in the person's own zone and
// language, through Temporal (Node has it); never an all-numeric date or a
// raw UTC stamp shown to a person (skills/dates-and-times). Every date the
// TUI shows goes through here. What an agent reads stays UTC.

/** The person's time of day for an instant, to the second: "14:05:09". */
export const timeOf = (instant: number): string =>
  Temporal.Instant.fromEpochMilliseconds(instant).toZonedDateTimeISO(Temporal.Now.timeZoneId()).toLocaleString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** The person's date and time for an instant: "3 Oct, 14:05" — the year too
 *  when it is not this one. */
export const dateTimeOf = (instant: number): string => {
  const zone = Temporal.Now.timeZoneId();
  const at = Temporal.Instant.fromEpochMilliseconds(instant).toZonedDateTimeISO(zone);
  const thisYear = at.year === Temporal.Now.zonedDateTimeISO(zone).year;
  return at.toLocaleString(undefined, { day: "numeric", month: "short", ...(thisYear ? {} : { year: "numeric" }), hour: "numeric", minute: "2-digit" });
};
