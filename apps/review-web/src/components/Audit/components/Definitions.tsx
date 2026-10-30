import { createMemo } from "solid-js";
import { defineChart } from "@tanstack/charts";
import { sunburst } from "@tanstack/charts/hierarchy/sunburst";
import { polar, radialText } from "@tanstack/charts/polar";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import { Chart } from "~/components/Chart";
import type { AuditPage } from "~/data";
import { compact } from "../numbers";
import { KIND_COLOUR, kindWord } from "../kinds";
import { PanelSkeleton } from "./PanelSkeleton";

/** What collagen's tool definitions put into every session's window, loaded
 *  when it starts and read again with each reply, used or not: a sunburst of
 *  the kinds inside, each kind's tools around it, every arc its tokens. */
export function Definitions(props: { definitions: AuditPage["definitions"] }) {
  const rows = createMemo(() =>
    props.definitions.map((definition) => ({
      path: `${kindWord(definition.kind)}/${definition.tool}`,
      tokens: definition.tokens,
    })),
  );
  const kindOf = createMemo(
    () =>
      new Map(
        props.definitions.flatMap((definition) => [
          [definition.tool, definition.kind] as const,
          [kindWord(definition.kind), definition.kind] as const,
        ]),
      ),
  );
  const total = () => props.definitions.reduce((sum, definition) => sum + definition.tokens, 0);
  const kinds = createMemo(() => [
    ...new Set(props.definitions.map((definition) => definition.kind)),
  ]);
  const definition = createMemo(() =>
    defineChart({
      marks: [
        polar({
          inset: 4,
          radiusRatio: 0.95,
          scales: {
            angle: { scale: scaleLinear().domain([0, 1]) },
            radius: { scale: scaleLinear().domain([0, 1]) },
          },
          marks: [
            sunburst(rows(), {
              path: "path",
              value: "tokens",
              sort: (left, right) => right.value - left.value,
              innerRadius: ({ radius }) => radius * 0.36,
              ringPadding: 2,
              color: (node) => kindOf().get(node.name) ?? "other",
              stroke: "var(--panel)",
              strokeWidth: 1,
            }),
            radialText([{ id: "total" }], {
              angle: 0,
              radius: 0,
              text: () => compact(total()),
              key: "id",
              fill: "currentColor",
              fontSize: 22,
              fontWeight: 700,
              baseline: "middle",
            }),
          ],
        }),
      ],
      scales: { x: null, y: null },
      color: { domain: kinds(), range: kinds().map((kind) => KIND_COLOUR[kind] ?? "var(--dim)") },
      tooltip: {
        use: tooltip,
        content: ([point]) => {
          const node = point?.datum as { name?: string; value?: number } | undefined;
          return node?.name
            ? {
                title: node.name,
                rows: [{ label: "", value: `${node.value!.toLocaleString()} tokens` }],
              }
            : { rows: [] };
        },
      },
    }),
  );
  return (
    <section class="audit-panel">
      <h2>Tool definitions</h2>
      <p class="audit-sub">Loaded into every session: {props.definitions.length} tools</p>
      <Chart
        definition={definition()}
        ariaLabel="Tool definition tokens by kind and tool"
        height={300}
      />
    </section>
  );
}

Definitions.Skeleton = () => (
  <PanelSkeleton
    title="Tool definitions"
    pending="Loaded into every session: 64 tools"
    height={300}
  />
);
