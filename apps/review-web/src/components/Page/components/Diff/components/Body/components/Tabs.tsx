import { Show } from "solid-js";
import type { TestFile } from "~/data";
import { showTab, tab } from "~/testsNow";

/** The code, how it works and the tests: tabs under the header, the second
 *  when the change has a machine drawn, the last when it has tests, counted. */
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
