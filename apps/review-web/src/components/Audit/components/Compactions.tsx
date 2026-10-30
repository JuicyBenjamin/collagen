import { createMemo, Show } from "solid-js";
import { defineChart, dot, ruleY } from "@tanstack/charts";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import { Chart } from "~/components/Chart";
import type { AuditPage } from "~/data";
import { dateOf, dateTimeOf } from "~/when";
import { compact } from "../numbers";
import { PanelSkeleton } from "./PanelSkeleton";

/** Each compaction over time, at the height of collagen's tokens in the session then. */
export function Compactions(props: { compactions: AuditPage["compactions"] }) {
  const rows = createMemo(() =>
    props.compactions.map((compaction, index) => ({
      id: `${index}`,
      time: Date.parse(compaction.at),
      tokens: compaction.collagenTokens,
    })),
  );
  const definition = createMemo(() =>
    defineChart({
      marks: [
        ruleY([0], { strokeOpacity: 0.4 }),
        dot(rows(), { x: "time", y: "tokens", r: 5, fill: "var(--color-secondary)" }),
      ],
      scales: {
        x: { scale: scaleLinear, axis: { ticks: { format: (value: number) => dateOf(value) } } },
        y: {
          scale: scaleLinear,
          nice: true,
          grid: true,
          axis: { ticks: { format: (value: number) => compact(value) } },
        },
      },
      tooltip: {
        use: tooltip,
        content: ([point]) =>
          point
            ? {
                title: dateTimeOf(point.datum.time),
                rows: [{ label: "", value: `${point.datum.tokens.toLocaleString()} tokens` }],
              }
            : { rows: [] },
      },
    }),
  );
  return (
    <section class="audit-panel">
      <h2>Compactions</h2>
      <p class="audit-sub">Collagen's tokens in the session when it compacted</p>
      <Show when={rows().length > 0} fallback={<p class="audit-none">None</p>}>
        <Chart definition={definition()} ariaLabel="Compactions over time" height={240} />
      </Show>
    </section>
  );
}

Compactions.Skeleton = () => (
  <PanelSkeleton
    title="Compactions"
    sub="Collagen's tokens in the session when it compacted"
    height={240}
  />
);
