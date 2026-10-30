import type { AnswerOutcome } from "~/data";

const SAID: Record<Exclude<AnswerOutcome, "answered">, string> = {
  "not-answerable": "Not answerable",
  "wrong-question": "Wrong question",
};

/** How an answer ended, said only when it is not simply answered. */
export function Outcome(props: { outcome: AnswerOutcome }) {
  return props.outcome === "answered" ? null : <span class={["badge badge-soft", props.outcome === "not-answerable" ? "badge-warning" : "badge-error"]}>{SAID[props.outcome]}</span>;
}
