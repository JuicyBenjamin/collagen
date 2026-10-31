import { createMemo, For } from "solid-js";
import { defineChart } from "@tanstack/charts";
import { pie, polar, radialArc, radialText } from "@tanstack/charts/polar";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { Chart } from "~/components/Chart";

/** The series colours in their order; past them the rest is one grey "Other". */
const SLOTS = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)", "var(--viz-4)"];

/** A whole split into a few parts: a donut with the total in its middle,
 *  and beside it each part's colour, name, count and share. */
export function Donut(props: {
  rows: ReadonlyArray<{ readonly name: string; readonly value: number }>;
  /** What one counts ("records"). */
  unit: string;
  ariaLabel: string;
}) {
  const parts = createMemo(() => {
    const sorted = [...props.rows].sort((a, b) => b.value - a.value);
    const shown = sorted.length > SLOTS.length ? sorted.slice(0, SLOTS.length - 1) : sorted;
    const rest = sorted.slice(shown.length).reduce((sum, row) => sum + row.value, 0);
    return [
      ...shown.map((row, index) => ({ ...row, colour: SLOTS[index]! })),
      ...(rest > 0 ? [{ name: "Other", value: rest, colour: "var(--viz-context)" }] : []),
    ];
  });
  const total = () => parts().reduce((sum, part) => sum + part.value, 0);
  const share = (value: number) => {
    const percent = (value / Math.max(1, total())) * 100;
    return percent > 0 && percent < 1 ? "<1%" : `${Math.round(percent)}%`;
  };
  const definition = createMemo(() =>
    defineChart({
      focusRing: false,
      marks: [
        polar({
          inset: 0,
          radiusRatio: 1,
          scales: {
            angle: { scale: scaleLinear().domain([0, 1]) },
            radius: { scale: scaleLinear().domain([0, 1]) },
          },
          marks: [
            radialArc(pie(parts(), { value: "value", gapAngle: 0.02 }), {
              innerRadius: ({ radius }) => radius * 0.64,
              cornerRadius: 4,
              color: "name",
              key: "name",
            }),
            radialText([{ id: "total" }], {
              angle: 0,
              radius: 0,
              text: () => total().toLocaleString(),
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
      color: {
        domain: parts().map((part) => part.name),
        range: parts().map((part) => part.colour),
      },
    }),
  );
  return (
    <div class="audit-donut">
      <Chart definition={definition()} ariaLabel={props.ariaLabel} height={200} />
      <ul class="audit-key">
        <For each={parts()}>
          {(part) => (
            <li>
              <i style={{ background: part.colour }} />
              <span class="audit-name">{part.name}</span>
              <span class="audit-number">{part.value.toLocaleString()}</span>
              <span class="audit-number audit-dim">{share(part.value)}</span>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}
