import { For, Show } from "solid-js";
import type { TestFile } from "~/data";
import { testFileId, testsJudged } from "~/testsNow";

/** The outline of the tests: how many are judged and questioned, and each
 *  file with how many of its tests changed. */
export function Tests(props: { files: ReadonlyArray<TestFile> }) {
  const judged = () => testsJudged(props.files);
  return (
    <>
      <p class="nav-title">Tests</p>
      <p class={["nav-viewed", { done: judged().judged === judged().tests }]}>
        {judged().judged} of {judged().tests} judged
        <Show when={judged().questioned > 0}>
          <span class="nav-questioned"> · {judged().questioned} questioned</span>
        </Show>
      </p>
      <ol>
        <For each={props.files}>
          {(file) => (
            <li>
              <a href={`#${testFileId(file.file)}`}>
                <span class="nav-what">{file.file.split("/").pop()}</span>
                <span class="count">{file.tests.length === 1 ? "1 test" : `${file.tests.length} tests`}</span>
              </a>
            </li>
          )}
        </For>
      </ol>
    </>
  );
}
