import type { TestFile } from "~/data";
import { showTab, tab } from "~/testsNow";

/** The code or the tests: two tabs under the header, the tests counted. */
export function Tabs(props: { tests: ReadonlyArray<TestFile> }) {
  return (
    <div class="tabs" role="tablist">
      <button type="button" role="tab" aria-selected={tab() === "code" ? "true" : "false"} class={{ on: tab() === "code" }} onClick={() => showTab("code")}>
        Code
      </button>
      <button type="button" role="tab" aria-selected={tab() === "tests" ? "true" : "false"} class={{ on: tab() === "tests" }} onClick={() => showTab("tests")}>
        Tests <span class="tab-count">{props.tests.reduce((count, file) => count + file.tests.length, 0)}</span>
      </button>
    </div>
  );
}
