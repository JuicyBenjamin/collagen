/** The column names sit in on the audit's charts that list things down the
 *  side: one width everywhere, the names left-aligned on the panel's own
 *  edge, so bars in panels side by side start at the same place. */
export const NAME_COLUMN = 124;

/** The y axis for a list of names: no line, no stubs, each name from the left edge. */
export const namesAxis = (width: number = NAME_COLUMN) => ({
  line: false,
  ticks: { size: 0, padding: 0 },
  tickLabels: { anchor: "start" as const, dx: -width },
});
