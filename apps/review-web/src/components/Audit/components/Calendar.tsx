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
/** Days named down the side, as a contribution grid does: every other one. */
const NAMED = new Set(["Mon", "Wed", "Fri"]);
/** One day's square, gap included, and the room the day names take. */
const CELL = 20;
const NAMES = 34;
/** Five steps of how much, from none to the most: one blue, lighter to stronger. */
const STEPS = [
  "var(--viz-empty)",
  "var(--viz-ramp-1)",
  "var(--viz-ramp-2)",
  "var(--viz-ramp-3)",
  "var(--viz-ramp-4)",
];

/** Every day of the period in the reader's own calendar, a week a column, as
 *  a grid of squares shaded by the tokens collagen's calls put in that day;
 *  beside it the days that had any and the busiest. */
export function Calendar(props: { calls: AuditPage["calls"]; days: number }) {
  const cells = createMemo(() => {
    const totals = new Map<string, number>();
    for (const call of props.calls) {
      const key = dayOf(Date.parse(call.at)).key;
      totals.set(key, (totals.get(key) ?? 0) + call.tokens);
    }
    const now = Date.now();
    const days = Array.from(
      { length: props.days },
      (_, index) => now - (props.days - 1 - index) * DAY,
    ).map((instant) => ({ instant, ...dayOf(instant) }));
    const firstWeekday = days[0]!.weekday;
    const top = Math.max(1, ...totals.values());
    return days.map((day, index) => {
      const tokens = totals.get(day.key) ?? 0;
      return {
        id: day.key,
        week: String(Math.floor((index + firstWeekday - 1) / 7)),
        weekday: WEEKDAYS[day.weekday - 1]!,
        instant: day.instant,
        level: String(tokens === 0 ? 0 : Math.min(4, 1 + Math.floor((tokens / top) * 3.999))),
        tokens,
      };
    });
  });
  const weeks = createMemo(() => [...new Set(cells().map((day) => day.week))]);
  const busiest = createMemo(() =>
    cells().reduce((most, day) => (day.tokens > most.tokens ? day : most), cells()[0]!),
  );
  const active = () => cells().filter((day) => day.tokens > 0).length;
  const definition = createMemo(() =>
    defineChart({
      marks: [cell(cells(), { x: "week", y: "weekday", color: "level", inset: 2, radius: 3 })],
      margin: { top: 0, right: 0, bottom: 0, left: NAMES },
      scales: {
        x: { scale: scaleBand<string>().domain(weeks()), axis: false },
        y: {
          scale: scaleBand<string>().domain(WEEKDAYS),
          axis: {
            ticks: {
              size: 0,
              padding: 0,
              format: (weekday: string) => (NAMED.has(weekday) ? weekday : ""),
            },
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
        <div class="audit-calendar-grid">
          <div style={{ width: `${NAMES + weeks().length * CELL}px` }}>
            <Chart
              definition={definition()}
              ariaLabel="Tokens from collagen's calls on each day"
              height={WEEKDAYS.length * CELL}
            />
          </div>
          <div class="audit-scale" aria-hidden="true">
            <span>Less</span>
            <For each={STEPS}>{(step) => <i style={{ background: step }} />}</For>
            <span>More</span>
          </div>
        </div>
        <dl class="audit-facts audit-facts-stacked">
          <div>
            <dt>Days with calls</dt>
            <dd>
              {active()} of {props.days}
            </dd>
          </div>
          <div>
            <dt>Busiest day</dt>
            <dd>
              {busiest().tokens === 0
                ? "None"
                : `${dateOf(busiest().instant)}, ${compact(busiest().tokens)} tokens`}
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

Calendar.Skeleton = () => (
  <PanelSkeleton title="Every day" sub="Tokens from collagen's calls">
    <div class="audit-calendar">
      <div class="audit-calendar-grid">
        <div
          class="audit-sk-body"
          style={{ width: `${NAMES + 5 * CELL}px`, height: `${WEEKDAYS.length * CELL}px` }}
        />
        <div class="audit-scale" aria-hidden="true">
          <span>Less</span>
          <For each={STEPS}>{(step) => <i style={{ background: step }} />}</For>
          <span>More</span>
        </div>
      </div>
      <dl class="audit-facts audit-facts-stacked">
        <div>
          <dt>Days with calls</dt>
          <dd>
            <Pending>24 of 30</Pending>
          </dd>
        </div>
        <div>
          <dt>Busiest day</dt>
          <dd>
            <Pending>21 Oct, 120k tokens</Pending>
          </dd>
        </div>
      </dl>
    </div>
  </PanelSkeleton>
);
