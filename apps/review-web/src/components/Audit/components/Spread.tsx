import { createMemo } from "solid-js";
import { boxX } from "@tanstack/charts/box";
import { defineChart } from "@tanstack/charts";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import { Chart } from "~/components/Chart";
import type { AuditPage } from "~/data";
import { compact } from "../numbers";
import { PanelSkeleton } from "./PanelSkeleton";

/** How many tokens one call of each busy tool puts in the window: its
 *  usual range as a box, its outliers as dots — a tool that sometimes
 *  sends far more than usual stands out before its average moves. */
export function Spread(props: { calls: AuditPage["calls"] }) {
  const tools = createMemo(() => {
    const counts = new Map<string, number>();
    for (const call of props.calls) counts.set(call.tool, (counts.get(call.tool) ?? 0) + 1);
    return [...counts]
      .filter(([, count]) => count >= 5)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([tool]) => tool);
  });
  const rows = createMemo(() => props.calls.filter((call) => tools().includes(call.tool)));
  const definition = createMemo(() =>
    defineChart({
      marks: [
        boxX(rows(), {
          x: "tokens",
          y: "tool",
          fill: "var(--color-primary)",
          fillOpacity: 0.35,
          stroke: "var(--color-primary)",
        }),
      ],
      scales: {
        y: { scale: () => scaleBand<string>().domain(tools()).padding(0.3) },
        x: {
          scale: scaleLinear,
          nice: true,
          grid: true,
          axis: { ticks: { format: (value: number) => compact(value) } },
        },
      },
      tooltip: {
        use: tooltip,
        content: ([point]) => {
          const box = point?.datum;
          if (!box) return { rows: [] };
          const value =
            box.kind === "summary"
              ? `${compact(box.q1)} to ${compact(box.q3)} tokens, usually ${compact(box.median)}`
              : `${box.value.toLocaleString()} tokens`;
          return { title: String(box.category), rows: [{ label: "", value }] };
        },
      },
    }),
  );
  return (
    <section class="audit-panel">
      <h2>Tokens a call, by tool</h2>
      <p class="audit-sub">The middle half as a box, the outliers as dots</p>
      <Chart
        definition={definition()}
        ariaLabel="Tokens a call for each busy tool"
        height={tools().length * 32 + 40}
      />
    </section>
  );
}

Spread.Skeleton = () => (
  <PanelSkeleton
    title="Tokens a call, by tool"
    sub="The middle half as a box, the outliers as dots"
    height={424}
  />
);
