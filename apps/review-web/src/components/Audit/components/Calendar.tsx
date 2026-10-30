import { createMemo } from "solid-js";
import { cell, defineChart } from "@tanstack/charts";
import { scaleBand } from "@tanstack/charts/scales/band";
import { tooltip } from "@tanstack/charts/tooltip";
import { Chart } from "~/components/Chart";
import type { AuditPage } from "~/data";
import { dateOf, dayOf } from "~/when";
import { compact } from "../numbers";
import { PanelSkeleton } from "./PanelSkeleton";

const DAY = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** Five steps of how much, from none to the most; none its own quiet colour. */
const STEPS = [
  "var(--line)",
  "color-mix(in oklab, var(--color-primary) 30%, var(--panel))",
  "color-mix(in oklab, var(--color-primary) 55%, var(--panel))",
  "color-mix(in oklab, var(--color-primary) 80%, var(--panel))",
  "var(--color-primary)",
];

/** Every day of the period in the reader's own calendar, a week a column,
 *  shaded by the tokens collagen's calls put into the AIs' windows that day. */
export function Calendar(props: { calls: AuditPage["calls"]; days: number }) {
  const cells = createMemo(() => {
    const totals = new Map<string, { tokens: number; calls: number }>();
    for (const call of props.calls) {
      const key = dayOf(Date.parse(call.at)).key;
      const day = totals.get(key) ?? { tokens: 0, calls: 0 };
      totals.set(key, { tokens: day.tokens + call.tokens, calls: day.calls + 1 });
    }
    const now = Date.now();
    const days = Array.from(
      { length: props.days },
      (_, index) => now - (props.days - 1 - index) * DAY,
    ).map((instant) => ({ instant, ...dayOf(instant) }));
    const firstWeekday = days[0]!.weekday;
    const top = Math.max(1, ...[...totals.values()].map((day) => day.tokens));
    return days.map((day, index) => {
      const total = totals.get(day.key) ?? { tokens: 0, calls: 0 };
      const level =
        total.tokens === 0 ? 0 : Math.min(4, 1 + Math.floor((total.tokens / top) * 3.999));
      return {
        id: day.key,
        week: String(Math.floor((index + firstWeekday - 1) / 7)),
        weekday: WEEKDAYS[day.weekday - 1]!,
        instant: day.instant,
        level: String(level),
        tokens: total.tokens,
        calls: total.calls,
      };
    });
  });
  const definition = createMemo(() =>
    defineChart({
      marks: [cell(cells(), { x: "week", y: "weekday", color: "level", inset: 2, radius: 3 })],
      scales: {
        x: {
          scale: scaleBand<string>().domain([...new Set(cells().map((day) => day.week))]),
          axis: false,
        },
        y: { scale: scaleBand<string>().domain(WEEKDAYS), axis: { ticks: { size: 0 } } },
      },
      color: { domain: ["0", "1", "2", "3", "4"], range: STEPS },
      tooltip: {
        use: tooltip,
        content: ([point]) => ({
          title: point ? dateOf(point.datum.instant) : "",
          rows: point
            ? [
                {
                  label: "",
                  value:
                    point.datum.tokens === 0
                      ? "No calls"
                      : `${point.datum.tokens.toLocaleString()} tokens`,
                },
              ]
            : [],
        }),
      },
    }),
  );
  return (
    <section class="audit-panel">
      <h2>Every day</h2>
      <p class="audit-sub">Tokens from collagen's calls</p>
      <Chart
        definition={definition()}
        ariaLabel="Tokens from collagen's calls on each day"
        height={200}
      />
    </section>
  );
}

Calendar.Skeleton = () => (
  <PanelSkeleton title="Every day" sub="Tokens from collagen's calls" height={200} />
);
