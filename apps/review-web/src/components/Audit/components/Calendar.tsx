import { createMemo, For } from "solid-js";
import { cell, defineChart } from "@tanstack/charts";
import { scaleBand } from "@tanstack/charts/scales/band";
import { tooltip } from "@tanstack/charts/tooltip";
import { Chart } from "~/components/Chart";
import type { AuditPage } from "~/data";
import { dateOf, dayOf } from "~/when";
import { namesAxis } from "../names";
import { compact } from "../numbers";
import { PanelSkeleton } from "./PanelSkeleton";
import { Pending } from "./Pending";

const DAY = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** One day's square, gap included: larger when there are few weeks to show. */
const cellFor = (weeks: number) => (weeks <= 6 ? 28 : 22);
/** The room the day names take, and the week dates above. */
const NAMES = 34;
const DATES = 20;
/** Five steps of how much, from none to the most: one blue, lighter to stronger. */
const STEPS = [
  "var(--viz-empty)",
  "var(--viz-ramp-1)",
  "var(--viz-ramp-2)",
  "var(--viz-ramp-3)",
  "var(--viz-ramp-4)",
];

/** Every day of the period in the reader's own calendar, a week a column
 *  dated by its Monday, shaded by the tokens collagen's calls put in that
 *  day; the scale under it runs from none to the busiest day's tokens. */
export function Calendar(props: { calls: AuditPage["calls"]; days: number }) {
  const grid = createMemo(() => {
    const totals = new Map<string, number>();
    for (const call of props.calls) {
      const key = dayOf(Date.parse(call.at)).key;
      totals.set(key, (totals.get(key) ?? 0) + call.tokens);
    }
    const now = Date.now();
    const days = Array.from(
      { length: props.days },
      (_, index) => now - (props.days - 1 - index) * DAY,
    ).map((instant) => ({
      instant,
      ...dayOf(instant),
    }));
    const firstWeekday = days[0]!.weekday;
    const firstMonday = days[0]!.instant - (firstWeekday - 1) * DAY;
    const top = Math.max(0, ...totals.values());
    const cells = days.map((day, index) => {
      const tokens = totals.get(day.key) ?? 0;
      return {
        id: day.key,
        week: String(Math.floor((index + firstWeekday - 1) / 7)),
        weekday: WEEKDAYS[day.weekday - 1]!,
        instant: day.instant,
        level: String(
          tokens === 0 ? 0 : Math.min(4, 1 + Math.floor((tokens / Math.max(1, top)) * 3.999)),
        ),
        tokens,
      };
    });
    const weeks = [...new Set(cells.map((day) => day.week))];
    return {
      cells,
      weeks,
      top,
      mondayOf: (week: string) => dateOf(firstMonday + Number(week) * 7 * DAY),
    };
  });
  const size = () => cellFor(grid().weeks.length);
  const definition = createMemo(() =>
    defineChart({
      marks: [cell(grid().cells, { x: "week", y: "weekday", color: "level", inset: 2, radius: 3 })],
      margin: { top: DATES, right: 0, bottom: 0, left: NAMES },
      scales: {
        x: {
          scale: scaleBand<string>().domain(grid().weeks),
          side: "top",
          axis: {
            line: false,
            ticks: { size: 0, padding: 4, format: (week: string) => grid().mondayOf(week) },
            tickLabels: { thin: true },
          },
        },
        y: {
          scale: scaleBand<string>().domain(WEEKDAYS),
          axis: {
            ...namesAxis(NAMES),
            ticks: { size: 0, padding: 0 },
            tickLabels: namesAxis(NAMES).tickLabels,
            line: false,
          },
        },
      },
      color: { domain: ["0", "1", "2", "3", "4"], range: STEPS },
      tooltip: {
        use: tooltip,
        content: ([point]) =>
          point
            ? {
                title: dateOf(point.datum.instant),
                rows: [
                  {
                    label: "",
                    value:
                      point.datum.tokens === 0
                        ? "No calls"
                        : `${point.datum.tokens.toLocaleString()} tokens`,
                  },
                ],
              }
            : { rows: [] },
      },
    }),
  );
  return (
    <section class="audit-panel">
      <h2>Every day</h2>
      <p class="audit-sub">Tokens from collagen's calls</p>
      <div class="audit-calendar">
        <div style={{ width: `${NAMES + grid().weeks.length * size()}px` }}>
          <Chart
            definition={definition()}
            ariaLabel="Tokens from collagen's calls on each day"
            height={DATES + WEEKDAYS.length * size()}
          />
        </div>
        <Scale top={compact(grid().top)} />
      </div>
    </section>
  );
}

/** What the shades mean: none on the left, the busiest day's tokens on the right. */
function Scale(props: { top: string | undefined }) {
  return (
    <div class="audit-scale">
      <span>0</span>
      <For each={STEPS}>{(step) => <i style={{ background: step }} />}</For>
      <span>{props.top ?? <Pending>149k</Pending>} tokens</span>
    </div>
  );
}

Calendar.Skeleton = () => (
  <PanelSkeleton title="Every day" sub="Tokens from collagen's calls">
    <div class="audit-calendar">
      <div
        class="audit-sk-body"
        style={{
          width: `${NAMES + 5 * cellFor(5)}px`,
          height: `${DATES + WEEKDAYS.length * cellFor(5)}px`,
        }}
      />
      <Scale top={undefined} />
    </div>
  </PanelSkeleton>
);
