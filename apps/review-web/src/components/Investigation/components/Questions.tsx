import { For, Show } from "solid-js";
import type { InvestigationPage } from "~/data";

/** What only the reader can decide, from every answer, numbered — whose
 *  answer asks it said only when more than one person answered. */
export function Questions(props: { questions: InvestigationPage["questions"] }) {
  const several = () => new Set(props.questions.map((question) => question.by)).size > 1;
  return (
    <Show when={props.questions.length > 0}>
      <section id="questions" class="inv-group">
        <h2 class="inv-group-name">Questions for you</h2>
        <ol class="list inv-questions">
          <For each={props.questions}>
            {(question, index) => (
              <li class="list-row">
                <span class="inv-number">{index() + 1}</span>
                <span>
                  {question.text}
                  <Show when={several()}>
                    <span class="inv-by"> {question.by}</span>
                  </Show>
                </span>
              </li>
            )}
          </For>
        </ol>
      </section>
    </Show>
  );
}
