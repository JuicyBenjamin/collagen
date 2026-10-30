import { createMemo, For } from "solid-js";
import { barX, defineChart } from "@tanstack/charts";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scaleOrdinal } from "@tanstack/charts/scales/ordinal";
import { tooltip } from "@tanstack/charts/tooltip";
import { Chart } from "~/components/Chart";
import type { AuditPage } from "~/data";
import { PanelSkeleton } from "./PanelSkeleton";

/** What each kind of tool is for, and its colour — the ticket kinds' own. */
export const KINDS = ["filing", "review", "tickets", "messages", "room", "setup", "diagnostics", "other"] as const;
export const KIND_COLOUR = ["var(--kind-plan)", "var(--kind-review)", "var(--kind-task)", "var(--kind-epic)", "var(--kind-proposal)", "var(--faint)", "var(--kind-bug)", "var(--dim)"];

/** How often each tool is called, the most called first. */
export function ToolCalls(props: { tools: AuditPage["tools"] }) {
  const rows = createMemo(() => [...props.tools].sort((a, b) => b.calls - a.calls).slice(0, 14));
  const definition = createMemo(() =>
    defineChart({
      marks: [barX(rows(), { x: "calls", y: "tool", color: "kind", inset: 3, radius: 3 })],
      scales: {
        y: { scale: () => scaleBand<string>().domain(rows().map((row) => row.tool)).padding(0.2) },
        x: { scale: scaleLinear, nice: true, grid: true },
      },
      color: { scale: scaleOrdinal<string, string>().domain([...KINDS]).range(KIND_COLOUR) },
      tooltip: {
        use: tooltip,
        items: [
          { id: "tool", label: "Tool", text: (point) => point.datum.tool },
          { id: "calls", label: "Calls", text: (point) => point.datum.calls.toLocaleString() },
        ],
      },
    }),
  );
  const shown = createMemo(() => KINDS.filter((kind) => rows().some((row) => row.kind === kind)));
  return (
    <section class="audit-panel">
      <h2>Tool calls</h2>
      <div class="audit-legend">
        <For each={shown()}>
          {(kind) => (
            <span>
              <i style={{ background: KIND_COLOUR[KINDS.indexOf(kind)] }} />
              {kind[0]!.toUpperCase() + kind.slice(1)}
            </span>
          )}
        </For>
      </div>
      <Chart definition={definition()} ariaLabel="Tool calls by tool" height={rows().length * 26 + 40} />
    </section>
  );
}

ToolCalls.Skeleton = () => <PanelSkeleton title="Tool calls" height={475} />;
