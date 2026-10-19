import { Show } from "solid-js";
import type { TestFile } from "~/data";
import { Masked } from "~/components/Masked";
import { showTab, tab } from "~/testsNow";

/** The code, how it works and the tests: tabs under the header, always there
 *  — the code's alone when there is nothing else — so what comes under them
 *  stands in the same place whatever the review holds. The second when the
 *  change has a machine drawn, the last when it has tests, counted. */
export function Tabs(props: { tests: ReadonlyArray<TestFile>; machine: boolean }) {
  return (
    <div class="tabs" role="tablist">
      <button type="button" role="tab" aria-selected={tab() === "code" ? "true" : "false"} class={{ on: tab() === "code" }} onClick={() => showTab("code")}>
        Code
      </button>
      <Show when={props.machine}>
        <button type="button" role="tab" aria-selected={tab() === "machine" ? "true" : "false"} class={{ on: tab() === "machine" }} onClick={() => showTab("machine")}>
          How it works
        </button>
      </Show>
      <Show when={props.tests.length > 0}>
        <button type="button" role="tab" aria-selected={tab() === "tests" ? "true" : "false"} class={{ on: tab() === "tests" }} onClick={() => showTab("tests")}>
          Tests <span class="tab-count">{props.tests.reduce((count, file) => count + file.tests.length, 0)}</span>
        </button>
      </Show>
    </div>
  );
}

/** The tabs before the diff is read: the code's, how it works when the
 *  review has a machine, and the tests as many as last time. */
Tabs.Skeleton = function Skeleton(props: { machine: boolean; tests: number }) {
  return (
    <div class="tabs sk" aria-hidden="true">
      <button type="button" tabindex={-1} class="on">
        <Masked>Code</Masked>
      </button>
      <Show when={props.machine}>
        <button type="button" tabindex={-1}>
          <Masked>How it works</Masked>
        </button>
      </Show>
      <Show when={props.tests > 0}>
        <button type="button" tabindex={-1}>
          <Masked>{`Tests ${props.tests}`}</Masked>
        </button>
      </Show>
    </div>
  );
};
