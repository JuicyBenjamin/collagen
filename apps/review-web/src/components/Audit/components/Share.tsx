import { createMemo } from "solid-js";
import { defineChart } from "@tanstack/charts";
import { pie, polar, radialArc, radialText } from "@tanstack/charts/polar";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { Chart } from "~/components/Chart";
import type { AuditPage } from "~/data";
import { compact } from "../numbers";
import { PanelSkeleton } from "./PanelSkeleton";

/** Collagen's share of every token its sessions read, as a gauge: the whole
 *  arc is everything the AIs read, the filled part what collagen put there. */
export function Share(props: { totals: AuditPage["totals"] }) {
  const share = () =>
    props.totals.allTokens === 0 ? 0 : props.totals.collagenTokens / props.totals.allTokens;
  const definition = createMemo(() => {
    const reading = { id: "collagen", value: share() };
    const slices = pie([reading, { id: "rest", value: 1 - share() }], {
      value: "value",
      startAngle: -Math.PI * 0.75,
      endAngle: Math.PI * 0.75,
    });
    return defineChart({
      marks: [
        polar({
          radiusRatio: 0.9,
          scales: {
            angle: { scale: scaleLinear().domain([0, 1]) },
            radius: { scale: scaleLinear().domain([0, 1]) },
          },
          marks: [
            radialArc(slices, {
              innerRadius: ({ radius }) => radius * 0.74,
              cornerRadius: 999,
              color: "id",
              key: "id",
            }),
            radialText([reading], {
              angle: 0,
              radius: 0,
              text: () => `${(share() * 100).toFixed(1)}%`,
              key: "id",
              fill: "currentColor",
              fontSize: 26,
              fontWeight: 700,
            }),
          ],
        }),
      ],
      scales: { x: null, y: null },
      color: { domain: ["collagen", "rest"], range: ["var(--color-primary)", "var(--line)"] },
    });
  });
  return (
    <section class="audit-panel">
      <h2>Collagen's share</h2>
      <p class="audit-sub">
        {compact(props.totals.collagenTokens)} of {compact(props.totals.allTokens)} tokens
      </p>
      <Chart
        definition={definition()}
        ariaLabel={`Collagen put ${(share() * 100).toFixed(1)}% of the tokens its sessions read`}
        height={200}
      />
    </section>
  );
}

Share.Skeleton = () => (
  <PanelSkeleton title="Collagen's share" pending="183M of 10.0B tokens" height={200} />
);
