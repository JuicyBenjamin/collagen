import { createMemo } from "solid-js";
import { barX, defineChart } from "@tanstack/charts";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import { Chart } from "~/components/Chart";
import type { AuditPage } from "~/data";
import { compact } from "../numbers";
import { PanelSkeleton } from "./PanelSkeleton";

/** How many tokens each tool's definition takes, the largest first. */
export function Definitions(props: { definitions: AuditPage["definitions"] }) {
  const rows = createMemo(() => props.definitions.largest.map((definition) => ({ id: definition.tool, tool: definition.tool, tokens: definition.tokens })));
  const definition = createMemo(() =>
    defineChart({
      marks: [barX(rows(), { x: "tokens", y: "tool", fill: "var(--faint)", inset: 3, radius: 3 })],
      scales: {
        y: { scale: () => scaleBand<string>().domain(rows().map((row) => row.tool)).padding(0.2) },
        x: { scale: scaleLinear, nice: true, grid: true, axis: { ticks: { format: (value: number) => compact(value) } } },
      },
      tooltip,
    }),
  );
  return (
    <section class="audit-panel">
      <h2>Tool definition size</h2>
      <p class="audit-sub">
        {props.definitions.tools} tools, {compact(props.definitions.tokens)} tokens
      </p>
      <Chart definition={definition()} ariaLabel="Tool definition size by tool" height={rows().length * 26 + 40} />
    </section>
  );
}

Definitions.Skeleton = () => <PanelSkeleton title="Tool definition size" height={393} lines={1} />;
