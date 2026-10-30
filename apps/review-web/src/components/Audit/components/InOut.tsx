import { createMemo } from "solid-js";
import { barX, defineChart, group } from "@tanstack/charts";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scaleOrdinal } from "@tanstack/charts/scales/ordinal";
import { tooltip } from "@tanstack/charts/tooltip";
import { Chart } from "~/components/Chart";
import type { AuditPage } from "~/data";
import { compact } from "../numbers";
import { PanelSkeleton } from "./PanelSkeleton";

/** Tokens in and out per tool, side by side from zero: how much an agent
 *  sends a tool against how much the tool sends back. */
export function InOut(props: { tools: AuditPage["tools"] }) {
  const tools = createMemo(() => [...props.tools].sort((a, b) => b.tokensIn + b.tokensOut - (a.tokensIn + a.tokensOut)).slice(0, 12));
  const rows = createMemo(() => tools().flatMap((tool) => [{ id: `${tool.tool} in`, tool: tool.tool, side: "In", tokens: tool.tokensIn }, { id: `${tool.tool} out`, tool: tool.tool, side: "Out", tokens: tool.tokensOut }]));
  const definition = createMemo(() =>
    defineChart({
      marks: [barX(rows(), { x: "tokens", y: "tool", color: "side", layout: group({ padding: 0.1 }), inset: 2 })],
      scales: {
        y: { scale: () => scaleBand<string>().domain(tools().map((tool) => tool.tool)).padding(0.2) },
        x: { scale: scaleLinear, nice: true, grid: true, axis: { ticks: { format: (value: number) => compact(value) } } },
      },
      color: { scale: scaleOrdinal<string, string>().domain(["In", "Out"]).range(["var(--color-primary)", "var(--color-warning)"]) },
      tooltip: {
        use: tooltip,
        items: [
          { id: "tool", label: "Tool", text: (point) => point.datum.tool },
          { id: "tokens", label: "Tokens", text: (point) => `${point.datum.tokens.toLocaleString()} ${point.datum.side === "In" ? "in" : "out"}` },
        ],
      },
    }),
  );
  return (
    <section class="audit-panel">
      <h2>Tokens in and out</h2>
      <div class="audit-legend">
        <span>
          <i style={{ background: "var(--color-primary)" }} />
          In
        </span>
        <span>
          <i style={{ background: "var(--color-warning)" }} />
          Out
        </span>
      </div>
      <Chart definition={definition()} ariaLabel="Tokens in and out by tool" height={tools().length * 34 + 40} />
    </section>
  );
}

InOut.Skeleton = () => (
  <PanelSkeleton
    title="Tokens in and out"
    legend={[
      { label: "In", colour: "var(--color-primary)" },
      { label: "Out", colour: "var(--color-warning)" },
    ]}
    height={443}
  />
);
