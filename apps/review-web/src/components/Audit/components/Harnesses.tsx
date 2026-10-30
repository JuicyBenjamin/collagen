import { createMemo, For } from "solid-js";
import { barX, defineChart, stack } from "@tanstack/charts";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scaleOrdinal } from "@tanstack/charts/scales/ordinal";
import { tooltip } from "@tanstack/charts/tooltip";
import { Chart } from "~/components/Chart";
import type { AuditPage } from "~/data";
import { PanelSkeleton } from "./PanelSkeleton";

/** Colours for names, one each across both bars, so no model shares a
 *  harness's colour; red is left out, as it reads as an error. */
const PALETTE = ["var(--color-primary)", "var(--color-warning)", "var(--color-success)", "var(--color-secondary)", "var(--color-info)", "var(--kind-investigation)", "var(--kind-bug)", "var(--faint)"];

/** Which harnesses and which models wrote the room's records: each a share
 *  of the whole, as one normalized bar, with the counts beside. */
export function Harnesses(props: { harnesses: AuditPage["harnesses"]; models: AuditPage["models"] }) {
  const names = createMemo(() => [...props.harnesses.map((harness) => harness.name), ...props.models.map((model) => model.name)]);
  const colourOf = (name: string) => PALETTE[names().indexOf(name) % PALETTE.length]!;
  const rows = createMemo(() => [
    ...props.harnesses.map((harness) => ({ id: `h ${harness.name}`, part: "Harnesses", name: harness.name, acts: harness.acts })),
    ...props.models.map((model) => ({ id: `m ${model.name}`, part: "Models", name: model.name, acts: model.acts })),
  ]);
  const definition = createMemo(() =>
    defineChart({
      marks: [barX(rows(), { x: "acts", y: "part", color: "name", layout: stack({ offset: "normalize" }), inset: 6 })],
      scales: {
        y: { scale: () => scaleBand<string>().domain(["Harnesses", "Models"]).padding(0.15) },
        x: { scale: scaleLinear, axis: { ticks: { format: (value: number) => `${Math.round(value * 100)}%` } } },
      },
      color: { scale: scaleOrdinal<string, string>().domain(names()).range(names().map(colourOf)) },
      tooltip: {
        use: tooltip,
        items: [
          { id: "name", label: "Who", text: (point) => point.datum.name },
          { id: "acts", label: "Records", text: (point) => point.datum.acts.toLocaleString() },
        ],
      },
    }),
  );
  const Legend = (legend: { entries: ReadonlyArray<{ readonly name: string; readonly acts: number }> }) => (
    <ul class="audit-key">
      <For each={legend.entries}>
        {(entry) => (
          <li>
            <i style={{ background: colourOf(entry.name) }} />
            <span>{entry.name}</span>
            <span class="audit-number">{entry.acts}</span>
          </li>
        )}
      </For>
    </ul>
  );
  return (
    <section class="audit-panel">
      <h2>Harnesses and models</h2>
      <p class="audit-sub">The room's records, by who wrote them</p>
      <Chart definition={definition()} ariaLabel="Share of the room's records by harness and by model" height={140} />
      <div class="audit-keys">
        <Legend entries={props.harnesses} />
        <Legend entries={props.models} />
      </div>
    </section>
  );
}

Harnesses.Skeleton = () => <PanelSkeleton title="Harnesses and models" sub="The room's records, by who wrote them" height={249} />;
