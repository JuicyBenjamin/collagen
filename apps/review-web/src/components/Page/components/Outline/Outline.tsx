import { For, Show } from "solid-js";
import type { ReviewPageData } from "~/data";
import { Arrives } from "~/components/Arrives";
import { Masked } from "~/components/Masked";
import { tab } from "~/testsNow";
import { Tests } from "./components/Tests";
import { Units } from "./components/Units";

/** The outline, once the diff is read: the units of the code, or the tests
 *  or stories when their tab is open. */
export function Outline(props: { data: ReviewPageData }) {
  const tests = () => props.data.grouped?.tests ?? [];
  const stories = () => props.data.grouped?.stories ?? [];
  const cases = () => (tab() === "tests" ? tests() : tab() === "stories" ? stories() : []);
  return (
    <Arrives skeleton={Outline.Skeleton}>
      <Show when={cases().length > 0} fallback={<Units data={props.data} />}>
        <Tests files={cases()} kind={tab() === "stories" ? "story" : "test"} />
      </Show>
    </Arrives>
  );
}

const ROWS = [
  "The parts that read first",
  "What the change is for",
  "Where its code goes",
] as const;

/** The outline before the diff is read: its title and a few rows. */
Outline.Skeleton = function Skeleton() {
  return (
    <div class="sk" role="status" aria-busy="true" aria-label="Reading the review">
      <p class="nav-title">
        <Masked>Units</Masked>
      </p>
      <p class="nav-viewed">
        <Masked>0 of 10 files viewed</Masked>
      </p>
      <ol>
        <For each={ROWS}>
          {(row) => (
            <li>
              <a>
                <span class="nav-what">
                  <Masked>{row}</Masked>
                </span>
                <span class="count">
                  <Masked>2 changes</Masked>
                </span>
              </a>
            </li>
          )}
        </For>
      </ol>
    </div>
  );
};
