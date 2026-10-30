import { createMemo } from "solid-js";
import { barX, defineChart, text } from "@tanstack/charts";
import { decorative } from "@tanstack/charts/mark/decorative";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import { Chart } from "~/components/Chart";
import { NAME_COLUMN, namesAxis } from "../names";

/** One bar a row, longest first, in the one series colour, each with its
 *  number at its end: for "which is the most" over named things. */
export function Ranked(props: {
  rows: ReadonlyArray<{ readonly name: string; readonly value: number }>;
  /** The number as the bar's label says it ("2.6k"). */
  label: (value: number) => string;
  /** The number as the tooltip says it ("2,612 tokens"). */
  says: (value: number) => string;
  ariaLabel: string;
}) {
  const rows = createMemo(() =>
    [...props.rows].sort((a, b) => b.value - a.value).map((row) => ({ id: row.name, ...row })),
  );
  const top = () => Math.max(1, ...rows().map((row) => row.value));
  const definition = createMemo(() =>
    defineChart({
      marks: [
        barX(rows(), { x: "value", y: "name", fill: "var(--viz-1)", inset: 3, radius: 4 }),
        decorative(
          text(rows(), {
            x: "value",
            y: "name",
            text: (row) => props.label(row.value),
            anchor: "start",
            dx: 6,
            fill: "currentColor",
            fontSize: 12,
          }),
        ),
      ],
      margin: { left: NAME_COLUMN, top: 0, bottom: 0, right: 0 },
      scales: {
        y: {
          scale: scaleBand<string>()
            .domain(rows().map((row) => row.name))
            .padding(0.25),
          axis: namesAxis(),
        },
        x: { scale: scaleLinear().domain([0, top() * 1.15]), axis: false },
      },
      tooltip: {
        use: tooltip,
        content: ([point]) =>
          point
            ? {
                title: point.datum.name,
                rows: [{ label: "", value: props.says(point.datum.value) }],
              }
            : { rows: [] },
      },
    }),
  );
  return (
    <Chart definition={definition()} ariaLabel={props.ariaLabel} height={rows().length * 28 + 8} />
  );
}
