import { For, Show } from "solid-js";
import type { AuditPage } from "~/data";
import { compact } from "../numbers";
import { PanelSkeleton } from "./PanelSkeleton";
import { Pending } from "./Pending";

/** The runs collagen started with the person's AI, by kind and model. */
export function Jobs(props: { jobs: AuditPage["jobs"]; cost: number | null }) {
  const top = () => Math.max(1, ...props.jobs.map((job) => job.tokensIn));
  return (
    <section class="audit-panel">
      <h2>Jobs</h2>
      <Show when={props.cost !== null}>
        <p class="audit-sub">${props.cost!.toFixed(2)}</p>
      </Show>
      <Show when={props.jobs.length > 0} fallback={<p class="audit-none">None</p>}>
        <div class="audit-grid audit-jobs" role="table" aria-label="Jobs by kind and model">
          <div class="audit-grid-head" role="row">
            <span role="columnheader">Job</span>
            <span role="columnheader">Model</span>
            <span role="columnheader">Tokens in</span>
            <span role="columnheader" class="audit-number">
              Runs
            </span>
          </div>
          <For each={props.jobs}>
            {(job) => (
              <div class="audit-grid-row" role="row">
                <span role="cell">{job.kind}</span>
                <span role="cell" class="audit-sub audit-flat">
                  {job.model}
                </span>
                <span role="cell" class="audit-share">
                  <span class="audit-track">
                    <i style={{ width: `${Math.max(1, (job.tokensIn / top()) * 100)}%` }} />
                  </span>
                  {compact(job.tokensIn)}
                </span>
                <span role="cell" class="audit-number">
                  {job.runs}
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}

Jobs.Skeleton = () => (
  <PanelSkeleton title="Jobs" pending="$2.12">
    <div class="audit-grid audit-jobs">
      <div class="audit-grid-head">
        <span>Job</span>
        <span>Model</span>
        <span>Tokens in</span>
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
              <Pending>3.4M tokens</Pending>
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
