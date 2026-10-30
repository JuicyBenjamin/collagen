import { For, Show } from "solid-js";
import type { AuditPage } from "~/data";
import { compact } from "../numbers";

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
        <table class="table table-sm audit-table">
          <thead>
            <tr>
              <th />
              <th>Tokens in</th>
              <th class="audit-number">Runs</th>
            </tr>
          </thead>
          <tbody>
            <For each={props.jobs}>
              {(job) => (
                <tr>
                  <td>
                    {job.kind}
                    <span class="audit-sub audit-block">{job.model}</span>
                  </td>
                  <td>
                    <span class="audit-bar">
                      <i style={{ width: `${Math.max(1, (job.tokensIn / top()) * 100)}%` }} />
                      {compact(job.tokensIn)}
                    </span>
                  </td>
                  <td class="audit-number">{job.runs}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
    </section>
  );
}
