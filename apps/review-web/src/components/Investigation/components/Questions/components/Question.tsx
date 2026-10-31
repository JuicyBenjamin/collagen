import { createSignal, Show } from "solid-js";
import type { QuestionView } from "~/data";
import { answerQuestion } from "~/api";

/** One question: what a yes would look into next, and, for the author while
 *  it is open, Yes and No. A yes that leads somewhere adds it as a goal and
 *  starts it; the page shows the new goal as it arrives. */
export function Question(props: { ticketId: string; question: QuestionView; number: number; named: boolean }) {
  const [sending, setSending] = createSignal(false);
  const [said, setSaid] = createSignal<string | null>(null);
  const answer = async (given: "yes" | "no") => {
    if (sending()) return;
    setSending(true);
    setSaid(null);
    try {
      const result = await answerQuestion(props.ticketId, props.question.id, given);
      if ("error" in result) setSaid(result.error);
    } catch (error) {
      setSaid(String(error));
    } finally {
      setSending(false);
    }
  };
  return (
    <li class="list-row inv-question">
      <span class="inv-number">{props.number}</span>
      <div class="inv-question-body">
        <p>
          {props.question.text}
          <Show when={props.named}>
            <span class="inv-by"> {props.question.by}</span>
          </Show>
        </p>
        <Show when={props.question.then}>{(then) => <p class="inv-then">Yes looks into: {then()}</p>}</Show>
        <Show when={said()}>{(why) => <p class="host-error">{why()}</p>}</Show>
      </div>
      <Show
        when={props.question.answer}
        fallback={
          <Show when={props.question.canAnswer}>
            <div class="inv-answer-buttons">
              <button type="button" class="btn btn-sm" disabled={sending()} onClick={() => void answer("no")}>
                No
              </button>
              <button type="button" class="btn btn-sm btn-primary" disabled={sending()} onClick={() => void answer("yes")}>
                Yes
              </button>
            </div>
          </Show>
        }
      >
        {(given) => <span class="inv-answered">{given() === "yes" ? "Yes" : "No"}</span>}
      </Show>
    </li>
  );
}
