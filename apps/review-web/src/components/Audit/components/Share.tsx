import { createMemo } from "solid-js";
import { defineChart } from "@tanstack/charts";
import { pie, polar, radialArc, radialText } from "@tanstack/charts/polar";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { Chart } from "~/components/Chart";
import type { AuditPage } from "~/data";
import { compact } from "../numbers";
import { PanelSkeleton } from "./PanelSkeleton";

/** What the AIs read in every session that called collagen, counted reply by
 *  reply (each reply reads the whole window again), and how much of it was
 *  collagen's own calls and answers while they stayed in the window. Tool
 *  definitions are not in it. The whole arc is all they read, the filled
 *  part collagen's. */
const SUB = "Its calls and answers, of all the AIs read in sessions that used it";

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
      color: { domain: ["collagen", "rest"], range: ["var(--viz-1)", "var(--viz-empty)"] },
    });
  });
  return (
    <section class="audit-panel">
      <h2>Collagen's share</h2>
      <p class="audit-sub">{SUB}</p>
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
  <PanelSkeleton title="Collagen's share" sub={SUB} pending="183M of 10.0B tokens" height={200} />
);
