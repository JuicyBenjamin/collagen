import { For, Show } from "solid-js";
import type { AuditPage } from "~/data";
import { compact } from "../numbers";
import { PanelSkeleton } from "./PanelSkeleton";

/** Tools whose calls got bigger last week, most first, each with its weekly trend. */
export function Growing(props: { growing: AuditPage["growing"] }) {
  const line = (weeks: ReadonlyArray<number>) => {
    const top = Math.max(1, ...weeks);
    return weeks.map((value, index) => `${index * 80},${(34 - (value / top) * 30).toFixed(1)}`).join(" ");
  };
  const change = (row: AuditPage["growing"][number]) => (row.to >= row.from * 2 ? `×${(row.to / row.from).toFixed(1)}` : `+${Math.round((row.to / row.from - 1) * 100)}%`);
  return (
    <section class="audit-panel">
      <h2>Growing</h2>
      <p class="audit-sub">Last week against the three before</p>
      <Show when={props.growing.length > 0} fallback={<p class="audit-none">Nothing grew</p>}>
        <ul class="audit-growing">
          <For each={props.growing}>
            {(row) => (
              <li>
                <span class="audit-growing-head">
                  <strong>{row.tool}</strong>
                  <span class={["badge badge-sm badge-soft", row.to >= row.from * 2 ? "badge-error" : "badge-warning"]}>{change(row)}</span>
                </span>
                <svg viewBox="0 0 240 36" class="audit-spark" role="img" aria-label={`${row.tool} weekly average`}>
                  <polyline points={line(row.weeks)} fill="none" stroke={row.to >= row.from * 2 ? "var(--color-error)" : "var(--color-warning)"} stroke-width="2" stroke-linejoin="round" />
                </svg>
                <span class="audit-sub">
                  {compact(row.from)} to {compact(row.to)} tokens a call
                </span>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}

Growing.Skeleton = () => <PanelSkeleton title="Growing" sub="Last week against the three before" height={403} />;
