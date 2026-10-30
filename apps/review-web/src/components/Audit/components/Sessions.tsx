import { For } from "solid-js";
import type { AuditPage } from "~/data";
import { PanelSkeleton } from "./PanelSkeleton";

/** The busiest sessions: their calls, collagen's share of their tokens, their compactions. */
export function Sessions(props: { sessions: AuditPage["sessions"] }) {
  const top = () => Math.max(0.01, ...props.sessions.map((session) => session.share));
  return (
    <section class="audit-panel">
      <h2>Sessions</h2>
      <div class="audit-scroll">
        <table class="table table-sm audit-table">
          <thead>
            <tr>
              <th>Session</th>
              <th class="audit-number">Tool calls</th>
              <th>Share of tokens</th>
              <th class="audit-number">Compactions</th>
            </tr>
          </thead>
          <tbody>
            <For each={props.sessions}>
              {(session) => (
                <tr>
                  <td>
                    <code>{session.id}</code>
                    <span class="audit-sub audit-block">{session.harness}</span>
                  </td>
                  <td class="audit-number">{session.calls}</td>
                  <td>
                    <span class="audit-bar">
                      <i style={{ width: `${Math.max(1, (session.share / top()) * 100)}%` }} />
                      {(session.share * 100).toFixed(1)}%
                    </span>
                  </td>
                  <td class="audit-number">{session.compactions}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </section>
  );
}

Sessions.Skeleton = () => <PanelSkeleton title="Sessions" height={427} />;
