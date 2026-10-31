import { createMemo, For, Show } from "solid-js";
import { barY, defineChart, text } from "@tanstack/charts";
import { decorative } from "@tanstack/charts/mark/decorative";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { Chart } from "~/components/Chart";
import type { AuditPage } from "~/data";
import { PanelSkeleton } from "./PanelSkeleton";
import { Pending } from "./Pending";

const SUB = "When a session's window filled up, how much of it was collagen's";
/** How much of the full window was collagen's, in steps a reader can name. */
const BINS = [
  { name: "None", below: 0 },
  { name: "Under 5%", below: 0.05 },
  { name: "5–10%", below: 0.1 },
  { name: "10–25%", below: 0.25 },
  { name: "25–50%", below: 0.5 },
  { name: "Half or more", below: Infinity },
] as const;
const percent = (share: number) => `${Math.round(share * 100)}%`;

/** Whether collagen makes sessions fill up: every compaction counted by how
 *  much of the window that filled was collagen's calls and answers. Most
 *  in the small steps means collagen is not what fills them. */
export function Compactions(props: { compactions: AuditPage["compactions"] }) {
  const shares = createMemo(() =>
    props.compactions.flatMap((compaction) =>
      compaction.windowTokens
        ? [Math.min(1, compaction.collagenTokens / compaction.windowTokens)]
        : [],
    ),
  );
  const unsized = () => props.compactions.length - shares().length;
  const bins = createMemo(() =>
    BINS.map((bin, index) => ({
      id: bin.name,
      name: bin.name,
      compactions: shares().filter((share) =>
        index === 0
          ? share === 0
          : share > 0 && share < bin.below && share >= (BINS[index - 1]!.below || 0),
      ).length,
    })),
  );
  const sorted = createMemo(() => [...shares()].sort((a, b) => a - b));
  const usual = () => sorted()[Math.floor(sorted().length / 2)] ?? 0;
  const most = () => sorted().at(-1) ?? 0;
  const largest = createMemo(() => {
    const counts = new Map<string, number>();
    for (const compaction of props.compactions)
      if (compaction.largest)
        counts.set(compaction.largest, (counts.get(compaction.largest) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  });
  const top = () => Math.max(1, ...bins().map((bin) => bin.compactions));
  const definition = createMemo(() =>
    defineChart({
      focusRing: false,
      marks: [
        barY(bins(), { x: "name", y: "compactions", fill: "var(--viz-1)", inset: 6, radius: 4 }),
        decorative(
          text(bins(), {
            x: "name",
            y: "compactions",
            text: (bin) => (bin.compactions > 0 ? String(bin.compactions) : ""),
            dy: -8,
            fill: "currentColor",
            fontSize: 12,
          }),
        ),
      ],
      scales: {
        x: {
          scale: scaleBand<string>()
            .domain(BINS.map((bin) => bin.name))
            .padding(0.2),
          axis: { ticks: { size: 0 } },
        },
        y: { scale: scaleLinear().domain([0, top() * 1.2]), axis: false },
      },
    }),
  );
  return (
    <section class="audit-panel">
      <h2>Compactions</h2>
      <p class="audit-sub">{SUB}</p>
      <Show when={props.compactions.length > 0} fallback={<p class="audit-none">None</p>}>
        <div class="audit-split">
          <dl class="audit-facts">
            <div>
              <dt>Compactions</dt>
              <dd>
                {props.compactions.length}
                <Show when={unsized() > 0}>
                  <span class="audit-dim"> ({unsized()} without a size)</span>
                </Show>
              </dd>
            </div>
            <div>
              <dt>Collagen's part, usually</dt>
              <dd>{percent(usual())}</dd>
            </div>
            <div>
              <dt>At most</dt>
              <dd>{percent(most())}</dd>
            </div>
            <Show when={largest()}>
              {(tool) => (
                <div>
                  <dt>Most often its largest answer</dt>
                  <dd>{tool()}</dd>
                </div>
              )}
            </Show>
          </dl>
          <Chart
            definition={definition()}
            ariaLabel="Compactions by how much of the full window was collagen's"
            height={220}
          />
        </div>
      </Show>
    </section>
  );
}

Compactions.Skeleton = () => (
  <PanelSkeleton title="Compactions" sub={SUB}>
    <div class="audit-split">
      <dl class="audit-facts">
        <For
          each={[
            "Compactions",
            "Collagen's part, usually",
            "At most",
            "Most often its largest answer",
          ]}
        >
          {(fact) => (
            <div>
              <dt>{fact}</dt>
              <dd>
                <Pending>get-tickets</Pending>
              </dd>
            </div>
          )}
        </For>
      </dl>
      <div class="audit-sk-body" style={{ height: "220px" }} />
    </div>
  </PanelSkeleton>
);
