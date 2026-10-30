import { For } from "solid-js";
import type { AuditPage } from "~/data";
import { Pending } from "./Pending";
import { compact } from "../numbers";

/** The headline numbers, a word each and their figure. */
export function Stats(props: { totals: AuditPage["totals"] }) {
  const share = () => (props.totals.allTokens === 0 ? "0%" : `${((100 * props.totals.collagenTokens) / props.totals.allTokens).toFixed(1)}% of all tokens`);
  return (
    <div class="audit-stats">
      <div class="audit-stat">
        <span class="audit-stat-title">Tool calls</span>
        <span class="audit-stat-value">{props.totals.calls.toLocaleString("en")}</span>
        <span class="audit-stat-desc">{props.totals.sessions} sessions</span>
      </div>
      <div class="audit-stat">
        <span class="audit-stat-title">Collagen tokens</span>
        <span class="audit-stat-value">{compact(props.totals.collagenTokens)}</span>
        <span class="audit-stat-desc">{share()}</span>
      </div>
      <div class="audit-stat">
        <span class="audit-stat-title">Compactions</span>
        <span class="audit-stat-value">{props.totals.compactions}</span>
      </div>
      <div class="audit-stat">
        <span class="audit-stat-title">Jobs</span>
        <span class="audit-stat-value">{props.totals.jobs}</span>
        {props.totals.jobCost !== null && <span class="audit-stat-desc">${props.totals.jobCost.toFixed(2)}</span>}
      </div>
      <div class="audit-stat">
        <span class="audit-stat-title">Tickets</span>
        <span class="audit-stat-value">{props.totals.tickets}</span>
        <span class="audit-stat-desc">{props.totals.openTickets} open</span>
      </div>
    </div>
  );
}

Stats.Skeleton = () => (
  <div class="audit-stats">
    <For each={["Tool calls", "Collagen tokens", "Compactions", "Jobs", "Tickets"]}>
      {(title) => (
        <div class="audit-stat">
          <span class="audit-stat-title">{title}</span>
          <span class="audit-stat-value">
            <Pending>1,000</Pending>
          </span>
          <span class="audit-stat-desc">
            <Pending>37 sessions</Pending>
          </span>
        </div>
      )}
    </For>
  </div>
);
