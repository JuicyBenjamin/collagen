import { createMemo } from "solid-js";
import { curveLinearClosed } from "d3-shape";
import { defineChart } from "@tanstack/charts";
import { angleGrid, polar, radialArea, radialGrid } from "@tanstack/charts/polar";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scalePoint } from "@tanstack/charts/scales/point";
import { tooltip } from "@tanstack/charts/tooltip";
import { Chart } from "~/components/Chart";
import type { AuditPage } from "~/data";
import { PanelSkeleton } from "./PanelSkeleton";

const KIND_WORDS: Record<string, string> = {
  work: "Work",
  host: "Repo host",
  deliver: "Delivery",
  run: "Jobs",
  investigate: "Investigating",
  report: "Reporting",
};
/** How far collagen may go on its own, from nothing to all the way. */
const STEPS: Record<string, number> = {
  "not chosen": 0,
  never: 0,
  "ask first": 1,
  "act, then tell": 2,
  "just do it": 3,
};
const SUB = "Ask first, act then tell, just do it: from the middle out";
const WHO = { Yours: "var(--viz-1)", "Others'": "var(--viz-2)" } as const;
const word = (level: string) => level[0]!.toUpperCase() + level.slice(1);

/** The person's steering as two shapes on one radar: how far collagen may
 *  go on its own for each kind, for their acts and for others'. The further
 *  out, the more it does without asking. */
export function Steering(props: { steering: AuditPage["steering"] }) {
  const kinds = () => props.steering.map((row) => KIND_WORDS[row.kind] ?? row.kind);
  const points = createMemo(() =>
    props.steering.flatMap((row) => [
      {
        id: `${row.kind} yours`,
        kind: KIND_WORDS[row.kind] ?? row.kind,
        who: "Yours" as const,
        level: row.mine,
        step: STEPS[row.mine] ?? 0,
      },
      {
        id: `${row.kind} others`,
        kind: KIND_WORDS[row.kind] ?? row.kind,
        who: "Others'" as const,
        level: row.others,
        step: STEPS[row.others] ?? 0,
      },
    ]),
  );
  const definition = createMemo(() =>
    defineChart({
      marks: [
        polar({
          radiusRatio: 0.75,
          scales: {
            angle: { scale: scalePoint<string>().domain(kinds()), wrap: true },
            radius: { scale: scaleLinear().domain([0, 3]) },
          },
          guides: [
            radialGrid({ values: [1, 2, 3], shape: "polygon", labels: false }),
            angleGrid({ labels: true, labelFontSize: 12 }),
          ],
          marks: [
            radialArea(points(), {
              angle: "kind",
              radius: "step",
              z: "who",
              color: "who",
              key: "id",
              curve: curveLinearClosed,
              fillOpacity: 0.18,
              stroke: (point) => WHO[point.who],
              strokeWidth: 2,
            }),
          ],
        }),
      ],
      scales: { x: null, y: null },
      color: { domain: Object.keys(WHO), range: Object.values(WHO) },
      tooltip: {
        use: tooltip,
        content: ([point]) => {
          const row = point?.datum as { kind?: string; who?: string; level?: string } | undefined;
          return row?.kind
            ? { title: row.kind, rows: [{ label: "", value: word(row.level!) }] }
            : { rows: [] };
        },
      },
    }),
  );
  return (
    <section class="audit-panel">
      <h2>Steering</h2>
      <p class="audit-sub">{SUB}</p>
      <div class="audit-legend">
        <span>
          <i style={{ background: WHO.Yours }} />
          Your acts
        </span>
        <span>
          <i style={{ background: WHO["Others'"] }} />
          Others' acts
        </span>
      </div>
      <Chart
        definition={definition()}
        ariaLabel="How far collagen goes on its own for each kind, for your acts and others'"
        height={340}
      />
    </section>
  );
}

Steering.Skeleton = () => (
  <PanelSkeleton
    title="Steering"
    sub={SUB}
    legend={[
      { label: "Your acts", colour: WHO.Yours },
      { label: "Others' acts", colour: WHO["Others'"] },
    ]}
    height={340}
  />
);
