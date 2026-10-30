import { createMemo } from "solid-js";
import { barX, defineChart } from "@tanstack/charts";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scaleOrdinal } from "@tanstack/charts/scales/ordinal";
import { tooltip } from "@tanstack/charts/tooltip";
import { Chart } from "~/components/Chart";
import type { AuditPage } from "~/data";
import { PanelSkeleton } from "./PanelSkeleton";

/** The room's tickets by kind, open and closed stacked. */
export function Tickets(props: { tickets: AuditPage["tickets"] }) {
  const rows = createMemo(() => props.tickets.flatMap((row) => [{ id: `${row.kind} open`, kind: row.kind, status: "Open", count: row.open }, { id: `${row.kind} closed`, kind: row.kind, status: "Closed", count: row.closed }]));
  const definition = createMemo(() =>
    defineChart({
      marks: [barX(rows(), { x: "count", y: "kind", color: "status", inset: 3 })],
      scales: {
        y: { scale: () => scaleBand<string>().domain(props.tickets.map((row) => row.kind)).padding(0.2) },
        x: { scale: scaleLinear, nice: true, grid: true },
      },
      color: { scale: scaleOrdinal<string, string>().domain(["Open", "Closed"]).range(["var(--color-success)", "var(--color-neutral)"]) },
      tooltip,
    }),
  );
  return (
    <section class="audit-panel">
      <h2>Tickets</h2>
      <div class="audit-legend">
        <span>
          <i style={{ background: "var(--color-success)" }} />
          Open
        </span>
        <span>
          <i style={{ background: "var(--color-neutral)" }} />
          Closed
        </span>
      </div>
      <Chart definition={definition()} ariaLabel="Tickets by kind, open and closed" height={props.tickets.length * 30 + 40} />
    </section>
  );
}

Tickets.Skeleton = () => <PanelSkeleton title="Tickets" height={175} />;
