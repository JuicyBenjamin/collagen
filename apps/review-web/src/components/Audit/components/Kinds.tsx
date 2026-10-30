import { createMemo, For } from "solid-js";
import { defineChart } from "@tanstack/charts";
import { pie, polar, radialArc, radialText } from "@tanstack/charts/polar";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import { Chart } from "~/components/Chart";
import type { AuditPage } from "~/data";
import { compact } from "../numbers";
import { KIND_COLOUR, KINDS, kindWord } from "../kinds";
import { PanelSkeleton } from "./PanelSkeleton";

/** What collagen's calls were for: a donut of the calls by kind of tool,
 *  the total in its middle, the kinds and their counts beside it. */
export function Kinds(props: { tools: AuditPage["tools"] }) {
  const rows = createMemo(() =>
    KINDS.map((kind) => ({
      kind,
      calls: props.tools
        .filter((tool) => tool.kind === kind)
        .reduce((sum, tool) => sum + tool.calls, 0),
    })).filter((row) => row.calls > 0),
  );
  const total = () => rows().reduce((sum, row) => sum + row.calls, 0);
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
            radialArc(pie(rows(), { value: "calls", gapAngle: 0.012 }), {
              innerRadius: ({ radius }) => radius * 0.62,
              cornerRadius: 3,
              color: "kind",
              key: "kind",
            }),
            radialText([{ id: "total" }], {
              angle: 0,
              radius: 0,
              text: () => compact(total()),
              key: "id",
              fill: "currentColor",
              fontSize: 24,
              fontWeight: 700,
              baseline: "middle",
            }),
          ],
        }),
      ],
      scales: { x: null, y: null },
      color: {
        domain: rows().map((row) => row.kind),
        range: rows().map((row) => KIND_COLOUR[row.kind] ?? "var(--dim)"),
      },
      tooltip: {
        use: tooltip,
        content: ([point]) => {
          const row = point?.datum as { kind?: string; calls?: number } | undefined;
          return row?.kind
            ? {
                title: kindWord(row.kind),
                rows: [{ label: "", value: `${row.calls!.toLocaleString()} calls` }],
              }
            : { rows: [] };
        },
      },
    }),
  );
  return (
    <section class="audit-panel">
      <h2>Calls by kind</h2>
      <div class="audit-donut">
        <Chart
          definition={definition()}
          ariaLabel="Collagen's calls by kind of tool"
          height={300}
        />
        <ul class="audit-key">
          <For each={rows()}>
            {(row) => (
              <li>
                <i style={{ background: KIND_COLOUR[row.kind] }} />
                <span>{kindWord(row.kind)}</span>
                <span class="audit-number">{row.calls.toLocaleString()}</span>
              </li>
            )}
          </For>
        </ul>
      </div>
    </section>
  );
}

Kinds.Skeleton = () => <PanelSkeleton title="Calls by kind" height={300} />;
