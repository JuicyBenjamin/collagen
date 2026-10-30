import { createMemo, For, Show } from "solid-js";
import { barX, defineChart } from "@tanstack/charts";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import { Chart } from "~/components/Chart";
import type { AuditPage } from "~/data";
import { PanelSkeleton } from "./PanelSkeleton";

/** Sessions by harness, and the room's records by model. */
export function Harnesses(props: { harnesses: AuditPage["harnesses"]; models: AuditPage["models"] }) {
  const rows = createMemo(() => props.harnesses.map((harness) => ({ id: harness.name, name: harness.name, sessions: harness.sessions })));
  const definition = createMemo(() =>
    defineChart({
      marks: [barX(rows(), { x: "sessions", y: "name", fill: "var(--color-primary)", inset: 3, radius: 3 })],
      scales: {
        y: { scale: () => scaleBand<string>().domain(rows().map((row) => row.name)).padding(0.25) },
        x: { scale: scaleLinear, nice: true, grid: true },
      },
      tooltip: {
        use: tooltip,
        items: [
          { id: "harness", label: "Harness", text: (point) => point.datum.name },
          { id: "sessions", label: "Sessions", text: (point) => point.datum.sessions.toLocaleString() },
        ],
      },
    }),
  );
  return (
    <section class="audit-panel">
      <h2>Harnesses</h2>
      <Chart definition={definition()} ariaLabel="Sessions by harness" height={rows().length * 36 + 40} />
      <Show when={props.models.length > 0}>
        <h3>Models</h3>
        <table class="table table-sm audit-table">
          <tbody>
            <For each={props.models}>
              {(model) => (
                <tr>
                  <td>{model.name}</td>
                  <td class="audit-number">{model.acts}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
    </section>
  );
}

Harnesses.Skeleton = () => <PanelSkeleton title="Harnesses" height={180} />;
