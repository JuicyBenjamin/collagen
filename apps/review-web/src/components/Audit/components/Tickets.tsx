import { createMemo, Show } from "solid-js";
import { curveBumpX } from "d3-shape";
import { defineChart, link, rect, text } from "@tanstack/charts";
import { d3Curve } from "@tanstack/charts/d3/shape";
import { sankeyDiagram } from "@tanstack/charts/network/sankey";
import { tooltip } from "@tanstack/charts/tooltip";
import { Chart } from "~/components/Chart";
import type { AuditPage } from "~/data";
import { OUTCOME_COLOUR, OUTCOMES, ticketColour } from "../kinds";
import { PanelSkeleton } from "./PanelSkeleton";

/** The room's tickets flowing from their kind to how they ended up: each
 *  band as wide as its tickets, so where the work goes reads at a glance. */
export function Tickets(props: { tickets: AuditPage["tickets"] }) {
  const flows = createMemo(() =>
    props.tickets.flatMap((row) =>
      OUTCOMES.map((outcome) => ({
        id: `${row.kind} ${outcome}`,
        kind: row.kind,
        outcome,
        tickets: outcome === "Open" ? row.open : outcome === "Done" ? row.done : row.dropped,
      })).filter((flow) => flow.tickets > 0),
    ),
  );
  const nodes = createMemo(() => [
    ...props.tickets.map((row) => ({
      id: row.kind,
      label: row.kind,
      colour: ticketColour(row.kind),
      side: "kind" as const,
    })),
    ...OUTCOMES.filter((outcome) => flows().some((flow) => flow.outcome === outcome)).map(
      (outcome) => ({
        id: outcome,
        label: outcome,
        colour: OUTCOME_COLOUR[outcome],
        side: "outcome" as const,
      }),
    ),
  ]);
  const definition = createMemo(() =>
    defineChart({
      marks: [
        sankeyDiagram({
          nodes: nodes(),
          links: flows(),
          nodeKey: "id",
          source: "kind",
          target: "outcome",
          value: "tickets",
          linkKey: "id",
          align: "justify",
          nodeWidth: 10,
          nodePadding: 10,
          inset: { left: 96, right: 96, top: 4, bottom: 4 },
          marks: ({ nodes: placed, links: bands }) =>
            [
              link(bands, {
                x1: "x1",
                y1: "y1",
                x2: "x2",
                y2: "y2",
                key: "key",
                curve: d3Curve(curveBumpX),
                strokeWidth: (band) => Math.max(1, band.width),
                stroke: (band) => OUTCOME_COLOUR[band.data.outcome],
                strokeOpacity: 0.35,
                lineCap: "butt",
              }),
              rect(placed, {
                x1: "x0",
                x2: "x1",
                y1: "y0",
                y2: "y1",
                key: "key",
                inset: 0,
                color: "key",
              }),
              text(placed, {
                x: (node) => (node.data.side === "kind" ? node.x0 - 8 : node.x1 + 8),
                y: "y",
                text: (node) => `${node.data.label} ${node.value}`,
                anchor: (node) => (node.data.side === "kind" ? "end" : "start"),
                key: "key",
                fill: "currentColor",
                fontSize: 12,
              }),
            ] as const,
        }),
      ],
      scales: { x: null, y: null },
      guides: false,
      color: { domain: nodes().map((node) => node.id), range: nodes().map((node) => node.colour) },
      margin: 0,
      tooltip: {
        use: tooltip,
        content: ([point]) => {
          const shown = point?.datum as
            | {
                value?: number;
                data?: { kind?: string; outcome?: string; tickets?: number; label?: string };
              }
            | undefined;
          if (shown?.data?.outcome)
            return {
              title: shown.data.kind,
              rows: [
                { label: "", value: `${shown.data.tickets} ${shown.data.outcome.toLowerCase()}` },
              ],
            };
          if (shown?.data?.label)
            return {
              title: shown.data.label,
              rows: [{ label: "", value: `${shown.value} tickets` }],
            };
          return { rows: [] };
        },
      },
    }),
  );
  return (
    <section class="audit-panel">
      <h2>Tickets</h2>
      <p class="audit-sub">From their kind to how they ended up</p>
      <Show when={flows().length > 0} fallback={<p class="audit-none">None</p>}>
        <Chart
          definition={definition()}
          ariaLabel="The room's tickets by kind, flowing to open, done or dropped"
          height={280}
        />
      </Show>
    </section>
  );
}

Tickets.Skeleton = () => (
  <PanelSkeleton title="Tickets" sub="From their kind to how they ended up" height={280} />
);
