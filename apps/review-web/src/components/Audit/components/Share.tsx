import { createMemo, For } from "solid-js";
import { defineChart } from "@tanstack/charts";
import { pie, polar, radialArc, radialText } from "@tanstack/charts/polar";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import { Chart } from "~/components/Chart";
import type { AuditPage } from "~/data";
import { compact } from "../numbers";
import { PanelSkeleton } from "./PanelSkeleton";
import { Pending } from "./Pending";

/** What the AIs read in every session that called collagen, counted reply by
 *  reply (each reply reads the whole window again), and how much of it was
 *  collagen's own calls and answers while they stayed in the window. Tool
 *  definitions are not in it. The whole arc is all they read, the filled
 *  part collagen's. */
const PARTS = [
  {
    id: "collagen",
    label: "Collagen",
    colour: "var(--viz-1)",
    says: "Its calls and answers, read again with every reply",
  },
  {
    id: "rest",
    label: "Session total",
    colour: "var(--viz-empty)",
    says: "All the AIs read in sessions that called collagen",
  },
] as const;

/** The gauge's two parts as a legend, each with its tokens. */
function Legend(props: { tokens: (id: string) => string | undefined }) {
  return (
    <div class="audit-legend audit-legend-key">
      <For each={PARTS}>
        {(part) => (
          <>
            <span>
              <i style={{ background: part.colour }} />
              {part.label}
            </span>
            <b class="audit-legend-value">{props.tokens(part.id) ?? <Pending>186M</Pending>}</b>
          </>
        )}
      </For>
    </div>
  );
}

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
      focusRing: false,
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
      color: { domain: PARTS.map((part) => part.id), range: PARTS.map((part) => part.colour) },
      // the legend gives the names and numbers; the hover says what each counts
      tooltip: {
        use: tooltip,
        content: ([point]) => {
          const part = PARTS.find(
            (each) => each.id === (point?.datum as { id?: string } | undefined)?.id,
          );
          return part ? { rows: [{ label: "", value: part.says }] } : { rows: [] };
        },
      },
    });
  });
  return (
    <section class="audit-panel">
      <h2>Collagen's share</h2>
      <Legend
        tokens={(id) =>
          compact(id === "collagen" ? props.totals.collagenTokens : props.totals.allTokens)
        }
      />
      <Chart
        definition={definition()}
        ariaLabel={`Collagen put ${(share() * 100).toFixed(1)}% of the tokens its sessions read`}
        height={200}
      />
    </section>
  );
}

Share.Skeleton = () => (
  <PanelSkeleton title="Collagen's share" height={200}>
    <Legend tokens={() => undefined} />
  </PanelSkeleton>
);
