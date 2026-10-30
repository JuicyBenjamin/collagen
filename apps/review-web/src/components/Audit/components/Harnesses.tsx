import { createMemo, For } from "solid-js";
import { defineChart } from "@tanstack/charts";
import { pie, polar, radialArc } from "@tanstack/charts/polar";
import { tooltip } from "@tanstack/charts/tooltip";
import { Chart } from "~/components/Chart";
import type { AuditPage } from "~/data";
import { PanelSkeleton } from "./PanelSkeleton";

/** Colours for names, one each across both rings, so no model shares a
 *  harness's colour; red is left out, as it reads as an error. */
const PALETTE = [
  "var(--color-primary)",
  "var(--color-warning)",
  "var(--color-success)",
  "var(--color-secondary)",
  "var(--color-info)",
  "var(--kind-investigation)",
  "var(--kind-bug)",
  "var(--faint)",
];

/** Which harnesses and which models wrote the room's records, as one
 *  donut of two rings: harnesses inside, the models they ran outside. */
export function Harnesses(props: {
  harnesses: AuditPage["harnesses"];
  models: AuditPage["models"];
}) {
  const names = createMemo(() => [
    ...props.harnesses.map((harness) => harness.name),
    ...props.models.map((model) => model.name),
  ]);
  const colourOf = (name: string) => PALETTE[names().indexOf(name) % PALETTE.length]!;
  const definition = createMemo(() =>
    defineChart({
      marks: [
        polar({
          inset: 4,
          radiusRatio: 0.95,
          scales: { angle: null, radius: null },
          marks: [
            radialArc(pie(props.harnesses, { value: "acts" }), {
              innerRadius: ({ radius }) => radius * 0.34,
              outerRadius: ({ radius }) => radius * 0.62,
              cornerRadius: 3,
              color: "name",
              key: "name",
            }),
            radialArc(pie(props.models, { value: "acts" }), {
              innerRadius: ({ radius }) => radius * 0.68,
              cornerRadius: 3,
              color: "name",
              key: "name",
            }),
          ],
        }),
      ],
      scales: { x: null, y: null },
      color: { domain: names(), range: names().map(colourOf) },
      tooltip: {
        use: tooltip,
        content: ([point]) => {
          const row = point?.datum as { name?: string; acts?: number } | undefined;
          return row?.name
            ? {
                title: row.name,
                rows: [{ label: "", value: `${row.acts!.toLocaleString()} records` }],
              }
            : { rows: [] };
        },
      },
    }),
  );
  const Legend = (legend: {
    title: string;
    entries: ReadonlyArray<{ readonly name: string; readonly acts: number }>;
  }) => (
    <div>
      <h3>{legend.title}</h3>
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
    </div>
  );
  return (
    <section class="audit-panel">
      <h2>Harnesses and models</h2>
      <p class="audit-sub">The room's records, by who wrote them</p>
      <div class="audit-donut">
        <Chart
          definition={definition()}
          ariaLabel="The room's records by harness, inside, and by model, outside"
          height={220}
        />
        <div class="audit-keys-stacked">
          <Legend title="Harnesses" entries={props.harnesses} />
          <Legend title="Models" entries={props.models} />
        </div>
      </div>
    </section>
  );
}

Harnesses.Skeleton = () => (
  <PanelSkeleton
    title="Harnesses and models"
    sub="The room's records, by who wrote them"
    height={220}
  />
);
