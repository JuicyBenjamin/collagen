import { For } from "solid-js";
import type { AuditPage } from "~/data";
import { Pending } from "./Pending";

const KIND_WORDS: Record<string, string> = { work: "Work", host: "Repo host", deliver: "Delivery", run: "Jobs", investigate: "Starting investigations", report: "Reporting findings" };
/** How far collagen may go on its own, as filled steps of three: none for
 *  not chosen or never, then ask first, act then tell, just do it. */
const STEPS: Record<string, number> = { "not chosen": 0, never: 0, "ask first": 1, "act, then tell": 2, "just do it": 3 };
const word = (level: string) => level[0]!.toUpperCase() + level.slice(1);

/** One level: its steps of autonomy, then its words — quiet when nothing is allowed. */
function Level(props: { level: string }) {
  const steps = () => STEPS[props.level] ?? 0;
  return (
    <span class={["audit-level", { quiet: steps() === 0 }]}>
      <span class="audit-steps" aria-hidden="true">
        <For each={[1, 2, 3]}>{(step) => <i class={{ on: step <= steps() }} />}</For>
      </span>
      {word(props.level)}
    </span>
  );
}

/** The person's steering: how far collagen may go on its own, for their
 *  acts and for others', by kind. */
export function Steering(props: { steering: AuditPage["steering"] }) {
  return (
    <section class="audit-panel audit-steering-panel">
      <h2>Steering</h2>
      <div class="audit-grid audit-steering" role="table" aria-label="Steering by kind">
        <div class="audit-grid-head" role="row">
          <span role="columnheader" />
          <span role="columnheader">Your acts</span>
          <span role="columnheader">Others' acts</span>
        </div>
        <For each={props.steering}>
          {(row) => (
            <div class="audit-grid-row" role="row">
              <span role="cell">{KIND_WORDS[row.kind] ?? row.kind}</span>
              <span role="cell">
                <Level level={row.mine} />
              </span>
              <span role="cell">
                <Level level={row.others} />
              </span>
            </div>
          )}
        </For>
      </div>
    </section>
  );
}

Steering.Skeleton = () => (
  <section class="audit-panel audit-steering-panel">
    <h2>Steering</h2>
    <div class="audit-grid audit-steering">
      <div class="audit-grid-head">
        <span />
        <span>Your acts</span>
        <span>Others' acts</span>
      </div>
      <For each={Object.values(KIND_WORDS)}>
        {(kind) => (
          <div class="audit-grid-row">
            <span>{kind}</span>
            <span>
              <Pending>Act, then tell</Pending>
            </span>
            <span>
              <Pending>Not chosen</Pending>
            </span>
          </div>
        )}
      </For>
    </div>
  </section>
);
