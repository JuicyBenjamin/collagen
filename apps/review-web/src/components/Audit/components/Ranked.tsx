import { createMemo } from "solid-js";
import { barX, defineChart, text } from "@tanstack/charts";
import { decorative } from "@tanstack/charts/mark/decorative";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import { Chart } from "~/components/Chart";
import { NAME_COLUMN, namesAxis } from "../names";

/** One bar a row, longest first, in the one series colour, each with its
 *  number at its end: for "which is the most" over named things. The name
 *  and number are on the page already, so hovering a bar shows only what is
 *  not: its `details`, or nothing when there are none. */
export function Ranked(props: {
  rows: ReadonlyArray<{ readonly name: string; readonly value: number }>;
  /** The number as the bar's label says it ("2.6k"). */
  label: (value: number) => string;
  /** What a bar's hover adds, a line each; none, no hover. */
  details?: (name: string) => ReadonlyArray<string>;
  ariaLabel: string;
}) {
  const rows = createMemo(() =>
    [...props.rows].sort((a, b) => b.value - a.value).map((row) => ({ id: row.name, ...row })),
  );
  const top = () => Math.max(1, ...rows().map((row) => row.value));
  const definition = createMemo(() => {
    const details = props.details;
    return defineChart({
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
      ...(details
        ? {
            tooltip: {
              use: tooltip,
              content: ([point]: ReadonlyArray<{ readonly datum: { readonly name: string } }>) =>
                point
                  ? { rows: details(point.datum.name).map((line) => ({ label: "", value: line })) }
                  : { rows: [] },
            },
          }
        : {}),
    });
  });
  return (
    <Chart definition={definition()} ariaLabel={props.ariaLabel} height={rows().length * 28 + 8} />
  );
}
