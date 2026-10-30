import { For } from "solid-js";
import type { AuditPage } from "~/data";
import { Pending } from "./Pending";

const KIND_WORDS: Record<string, string> = { work: "Work", host: "Repo host", deliver: "Delivering to your sessions", run: "Jobs", investigate: "Starting investigations", report: "Reporting findings" };
const TONE: Record<string, string> = { "not chosen": "badge-ghost", never: "badge-ghost", "ask first": "badge-info", "act, then tell": "badge-warning", "just do it": "badge-success" };
const word = (level: string) => level[0]!.toUpperCase() + level.slice(1);

/** The person's steering, theirs and others', by kind. */
export function Steering(props: { steering: AuditPage["steering"] }) {
  return (
    <section class="audit-panel">
      <h2>Steering</h2>
      <table class="table table-sm audit-table">
        <thead>
          <tr>
            <th />
            <th>Yours</th>
            <th>Others'</th>
          </tr>
        </thead>
        <tbody>
          <For each={props.steering}>
            {(row) => (
              <tr>
                <td>{KIND_WORDS[row.kind] ?? row.kind}</td>
                <td>
                  <span class={["badge badge-sm badge-soft", TONE[row.mine] ?? "badge-ghost"]}>{word(row.mine)}</span>
                </td>
                <td>
                  <span class={["badge badge-sm badge-soft", TONE[row.others] ?? "badge-ghost"]}>{word(row.others)}</span>
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </section>
  );
}


Steering.Skeleton = () => (
  <section class="audit-panel">
    <h2>Steering</h2>
    <table class="table table-sm audit-table">
      <thead>
        <tr>
          <th />
          <th>Yours</th>
          <th>Others'</th>
        </tr>
      </thead>
      <tbody>
        <For each={Object.values(KIND_WORDS)}>
          {(kind) => (
            <tr>
              <td>{kind}</td>
              <td>
                <Pending>Act, then tell</Pending>
              </td>
              <td>
                <Pending>Not chosen</Pending>
              </td>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  </section>
);
