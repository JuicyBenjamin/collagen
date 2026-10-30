import type { AuditPage } from "~/data";
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
