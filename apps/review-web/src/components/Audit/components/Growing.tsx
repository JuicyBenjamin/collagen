import { createMemo, Show } from "solid-js";
import { defineChart, dot, link } from "@tanstack/charts";
import { decorative } from "@tanstack/charts/mark/decorative";
import { scaleOrdinal } from "@tanstack/charts/scales/ordinal";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import { Chart } from "~/components/Chart";
import type { AuditPage } from "~/data";
import { compact } from "../numbers";
import { PanelSkeleton } from "./PanelSkeleton";

/** Tools whose calls got bigger: each a dumbbell from the three weeks
 *  before to last week, so how far and which way reads at once. */
export function Growing(props: { growing: AuditPage["growing"] }) {
  const rows = createMemo(() => props.growing.map((row) => ({ id: row.tool, tool: row.tool, from: row.from, to: row.to })));
  const ends = createMemo(() => rows().flatMap((row) => [{ id: `${row.tool} before`, tool: row.tool, when: "Before", tokens: row.from, change: row.to / row.from }, { id: `${row.tool} last`, tool: row.tool, when: "Last week", tokens: row.to, change: row.to / row.from }]));
  const change = (ratio: number) => (ratio >= 2 ? `×${ratio.toFixed(1)}` : `+${Math.round((ratio - 1) * 100)}%`);
  const definition = createMemo(() =>
    defineChart({
      marks: [
        decorative(link(rows(), { x1: "from", x2: "to", y1: "tool", y2: "tool", stroke: "var(--color-warning)", strokeWidth: 2 })),
        dot(ends(), { x: "tokens", y: "tool", r: 5, color: "when" }),
      ],
      color: { scale: scaleOrdinal<string, string>().domain(["Before", "Last week"]).range(["var(--faint)", "var(--color-warning)"]) },
      scales: {
        y: { scale: () => scaleBand<string>().domain(rows().map((row) => row.tool)).padding(0.3) },
        x: { scale: scaleLinear, nice: true, grid: true, axis: { ticks: { format: (value: number) => compact(value) } } },
      },
      tooltip: {
        use: tooltip,
        items: [
          { id: "tool", label: "Tool", text: (point) => point.datum.tool },
          { id: "when", label: "When", text: (point) => point.datum.when },
          { id: "tokens", label: "Tokens a call", text: (point) => point.datum.tokens.toLocaleString() },
          { id: "change", label: "Change", text: (point) => change(point.datum.change) },
        ],
      },
    }),
  );
  return (
    <section class="audit-panel">
      <h2>Growing</h2>
      <p class="audit-sub">Tokens a call, the three weeks before against last week</p>
      <div class="audit-legend">
        <span>
          <i style={{ background: "var(--faint)" }} />
          Before
        </span>
        <span>
          <i style={{ background: "var(--color-warning)" }} />
          Last week
        </span>
      </div>
      <Show when={rows().length > 0} fallback={<p class="audit-none">Nothing grew</p>}>
        <Chart definition={definition()} ariaLabel="Tokens a call before and last week, for the tools that grew" height={rows().length * 44 + 40} />
      </Show>
    </section>
  );
}

Growing.Skeleton = () => (
  <PanelSkeleton
    title="Growing"
    sub="Tokens a call, the three weeks before against last week"
    legend={[
      { label: "Before", colour: "var(--faint)" },
      { label: "Last week", colour: "var(--color-warning)" },
    ]}
    height={207}
  />
);
