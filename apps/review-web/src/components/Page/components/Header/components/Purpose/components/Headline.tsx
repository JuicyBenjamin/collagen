import { createEffect, Show } from "solid-js";
import type { ReviewPageHead } from "~/data";

/** The headline — a few words, what the change is for — and the summary
 *  beneath it. A review filed before titles has only its branch's name for
 *  a goal: its summary leads instead. The tab says it too. */
export function Headline(props: { head: ReviewPageHead }) {
  const headline = () =>
    props.head.ticket.title ??
    (props.head.ticket.kind === "review" && props.head.review.summary.trim().length > 0
      ? props.head.review.summary
      : props.head.ticket.goal);
  const beneath = () =>
    headline() === props.head.review.summary ? "" : props.head.review.summary.trim();
  createEffect(
    () => props.head.ticket.title ?? props.head.ticket.goal,
    (name) => {
      document.title = `${name} — review`;
    },
  );
  return (
    <>
      <h1 class="purpose">{headline()}</h1>
      <Show when={beneath()}>
        <p class="summary">{beneath()}</p>
      </Show>
    </>
  );
}
