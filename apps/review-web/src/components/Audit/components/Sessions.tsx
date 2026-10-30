import { createMemo, For, Show } from "solid-js";
import type { AuditPage } from "~/data";
import { PanelSkeleton } from "./PanelSkeleton";
import { Pending } from "./Pending";

/** The busiest sessions, by the name the person knows them by: their calls,
 *  collagen's share of their tokens (a bar on one scale for all), their
 *  compactions. The harness shows only when more than one is in the list. */
export function Sessions(props: { sessions: AuditPage["sessions"] }) {
  const mixed = createMemo(() => new Set(props.sessions.map((session) => session.harness)).size > 1);
  /** the bar's scale: the largest share, rounded up to a tenth, so bars compare */
  const scale = createMemo(() => Math.max(0.1, Math.ceil(Math.max(...props.sessions.map((session) => session.share)) * 10) / 10));
  return (
    <section class="audit-panel">
      <h2>Sessions</h2>
      <div class="audit-grid audit-sessions" role="table" aria-label="The busiest sessions">
        <div class="audit-grid-head" role="row">
          <span role="columnheader">Session</span>
          <span role="columnheader" class="audit-number">Tool calls</span>
          <span role="columnheader">Share of tokens</span>
          <span role="columnheader" class="audit-number">Compactions</span>
        </div>
        <For each={props.sessions}>
          {(session) => (
            <div class="audit-grid-row" role="row">
              <span role="cell" class="audit-name" title={session.title ?? session.id}>
                {session.title ?? session.id}
                <Show when={mixed()}>
                  <span class="audit-sub"> {session.harness}</span>
                </Show>
              </span>
              <span role="cell" class="audit-number">{session.calls}</span>
              <span role="cell" class="audit-share">
                <span class="audit-track">
                  <i style={{ width: `${Math.max(1, (session.share / scale()) * 100)}%` }} />
                </span>
                {(session.share * 100).toFixed(1)}%
              </span>
              <span role="cell" class="audit-number">{session.compactions}</span>
            </div>
          )}
        </For>
      </div>
    </section>
  );
}

Sessions.Skeleton = () => (
  <PanelSkeleton title="Sessions">
    <div class="audit-grid audit-sessions">
      <div class="audit-grid-head">
        <span>Session</span>
        <span class="audit-number">Tool calls</span>
        <span>Share of tokens</span>
        <span class="audit-number">Compactions</span>
      </div>
      <For each={[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]}>
        {() => (
          <div class="audit-grid-row">
            <span>
              <Pending>Collagen MCP bug fix</Pending>
            </span>
            <span class="audit-number">
              <Pending>367</Pending>
            </span>
            <span>
              <Pending>5.4% of tokens</Pending>
            </span>
            <span class="audit-number">
              <Pending>3</Pending>
            </span>
          </div>
        )}
      </For>
    </div>
  </PanelSkeleton>
);
