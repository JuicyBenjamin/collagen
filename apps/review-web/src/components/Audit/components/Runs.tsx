import { For, Show } from "solid-js";
import type { AuditPage } from "~/data";
import { compact } from "../numbers";
import { PanelSkeleton } from "./PanelSkeleton";
import { Pending } from "./Pending";

/** The AI sessions collagen started itself, by kind and model, and the
 *  tokens they read and wrote — counted, never priced: a price would be a guess. */
export function Runs(props: { runs: AuditPage["runs"]; tokens: number }) {
  const tokensOf = (run: AuditPage["runs"][number]) => run.tokensIn + run.tokensOut;
  const top = () => Math.max(1, ...props.runs.map(tokensOf));
  return (
    <section class="audit-panel">
      <h2>Collagen's runs</h2>
      <p class="audit-sub">Sessions it started itself, {compact(props.tokens)} tokens</p>
      <Show when={props.runs.length > 0} fallback={<p class="audit-none">None</p>}>
        <div
          class="audit-grid audit-runs"
          role="table"
          aria-label="Collagen's runs by kind and model"
        >
          <div class="audit-grid-head" role="row">
            <span role="columnheader">Kind</span>
            <span role="columnheader">Model</span>
            <span role="columnheader">Tokens</span>
            <span role="columnheader" class="audit-number">
              Runs
            </span>
          </div>
          <For each={props.runs}>
            {(run) => (
              <div class="audit-grid-row" role="row">
                <span role="cell">{run.kind}</span>
                <span role="cell" class="audit-sub audit-flat">
                  {run.model}
                </span>
                <span role="cell" class="audit-share">
                  <span class="audit-track">
                    <i style={{ width: `${Math.max(1, (tokensOf(run) / top()) * 100)}%` }} />
                  </span>
                  {compact(tokensOf(run))}
                </span>
                <span role="cell" class="audit-number">
                  {run.runs}
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}

Runs.Skeleton = () => (
  <PanelSkeleton title="Collagen's runs" pending="Sessions it started itself, 2.4M tokens">
    <div class="audit-grid audit-runs">
      <div class="audit-grid-head">
        <span>Kind</span>
        <span>Model</span>
        <span>Tokens</span>
        <span class="audit-number">Runs</span>
      </div>
      <For each={[0, 1, 2]}>
        {() => (
          <div class="audit-grid-row">
            <span>
              <Pending>Investigations</Pending>
            </span>
            <span>
              <Pending>Claude Sonnet 5.5</Pending>
            </span>
            <span>
              <Pending>3.4M</Pending>
            </span>
            <span class="audit-number">
              <Pending>11</Pending>
            </span>
          </div>
        )}
      </For>
    </div>
  </PanelSkeleton>
);
