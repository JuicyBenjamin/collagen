import { For, Show } from "solid-js";
import type { InvestigationPage } from "~/data";
import { Question } from "./components/Question";

/** What only the reader can decide, from every answer, numbered — whose
 *  answer asks it said only when more than one person answered. */
export function Questions(props: { ticketId: string; questions: InvestigationPage["questions"] }) {
  const several = () => new Set(props.questions.map((question) => question.by)).size > 1;
  return (
    <Show when={props.questions.length > 0}>
      <section id="questions" class="inv-group">
        <h2 class="inv-group-name">Questions for you</h2>
        <ol class="list inv-questions">
          <For each={props.questions}>{(question, index) => <Question ticketId={props.ticketId} question={question} number={index() + 1} named={several()} />}</For>
        </ol>
      </section>
    </Show>
  );
}
