import { createMemo, Show } from "solid-js";
import { defineChart, dot, link, text } from "@tanstack/charts";
import { decorative } from "@tanstack/charts/mark/decorative";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scaleOrdinal } from "@tanstack/charts/scales/ordinal";
import { tooltip } from "@tanstack/charts/tooltip";
import { Chart } from "~/components/Chart";
import type { AuditPage } from "~/data";
import { NAME_COLUMN, namesAxis } from "../names";
import { compact } from "../numbers";
import { PanelSkeleton } from "./PanelSkeleton";

const SUB = "Tokens in an average call, the three weeks before and last week";
const LEGEND = [
  { label: "Three weeks before", colour: "var(--viz-context)" },
  { label: "Last week", colour: "var(--viz-1)" },
];
const change = (ratio: number) =>
  ratio >= 2 ? `×${ratio.toFixed(1)}` : `+${Math.round((ratio - 1) * 100)}%`;

/** Tools whose every call got bigger — not called more, each call sending
 *  more: a line from the average call before to last week's, and how much. */
export function Growing(props: { growing: AuditPage["growing"] }) {
  const rows = createMemo(() =>
    props.growing.map((row) => ({
      id: row.tool,
      tool: row.tool,
      from: row.from,
      to: row.to,
      change: change(row.to / row.from),
    })),
  );
  const ends = createMemo(() =>
    rows().flatMap((row) => [
      {
        id: `${row.tool} before`,
        tool: row.tool,
        from: row.from,
        to: row.to,
        when: "Three weeks before",
        tokens: row.from,
      },
      {
        id: `${row.tool} last`,
        tool: row.tool,
        from: row.from,
        to: row.to,
        when: "Last week",
        tokens: row.to,
      },
    ]),
  );
  const top = () => Math.max(1, ...rows().map((row) => row.to));
  const definition = createMemo(() =>
    defineChart({
      focusRing: { fill: "var(--panel)", strokeWidth: 2 },
      // a row is one thing: hovering anywhere along it is that row
      focus: "nearest-y",
      marks: [
        decorative(
          link(rows(), {
            x1: "from",
            x2: "to",
            y1: "tool",
            y2: "tool",
            stroke: "var(--viz-1)",
            strokeWidth: 2,
          }),
        ),
        dot(ends(), { x: "tokens", y: "tool", r: 5, color: "when" }),
        decorative(
          text(rows(), {
            x: "to",
            y: "tool",
            text: "change",
            anchor: "start",
            dx: 10,
            fill: "currentColor",
            fontSize: 12,
            fontWeight: 600,
          }),
        ),
      ],
      color: {
        scale: scaleOrdinal<string, string>()
          .domain(LEGEND.map((entry) => entry.label))
          .range(LEGEND.map((entry) => entry.colour)),
      },
      margin: { left: NAME_COLUMN },
      scales: {
        y: {
          scale: scaleBand<string>()
            .domain(rows().map((row) => row.tool))
            .padding(0.3),
          axis: namesAxis(),
        },
        x: {
          scale: scaleLinear().domain([0, top() * 1.3]),
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
                rows: [
                  {
                    label: "",
                    value: `${point.datum.from.toLocaleString()} to ${point.datum.to.toLocaleString()} tokens a call`,
                  },
                ],
              }
            : { rows: [] },
      },
    }),
  );
  return (
    <section class="audit-panel">
      <h2>Bigger calls</h2>
      <p class="audit-sub">{SUB}</p>
      <div class="audit-legend">
        {LEGEND.map((entry) => (
          <span>
            <i style={{ background: entry.colour }} />
            {entry.label}
          </span>
        ))}
      </div>
      <Show
        when={rows().length > 0}
        fallback={<p class="audit-none">No tool's calls got bigger</p>}
      >
        <Chart
          definition={definition()}
          ariaLabel="Tokens in an average call before and last week, for the tools whose calls got bigger"
          height={rows().length * 44 + 40}
        />
      </Show>
    </section>
  );
}

Growing.Skeleton = () => (
  <PanelSkeleton title="Bigger calls" sub={SUB} legend={LEGEND} height={216} />
);
