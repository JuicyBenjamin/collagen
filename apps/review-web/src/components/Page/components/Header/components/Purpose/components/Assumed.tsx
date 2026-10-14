import { Show } from "solid-js";
import type { ReviewPageHead } from "~/data";
import { Appear } from "~/components/Appear";
import { assumedNow } from "~/assumedNow";

/** A why guessed, not told: whose guess it is, and once the code's author
 *  took it over, how many guesses they confirmed, corrected or called wrong. */
export function Assumed(props: { head: ReviewPageHead }) {
  // the guesses not answered yet — all of them, until the code's author took it over
  const open = () =>
    props.head.review.decisions.filter((decision) => assumedNow.isGuess(decision)).length;
  const said = (verdict: string) =>
    props.head.review.decisions.filter((decision) => decision.verdict === verdict).length +
    props.head.review.forks.filter((fork) => fork.verdict === verdict).length;
  return (
    <Appear when={props.head.review.assumed}>
      {() => (
        <Show
          when={props.head.review.claimed}
          fallback={
            <div class="assumed-banner" role="note">
              <p>Assumption-based review by {props.head.review.authorName}</p>
            </div>
          }
        >
          {(claimed) => (
            <div class="assumed-banner claimed" role="note">
              <p>
                Assumption-based review by {claimed().guessedByName}, answered by{" "}
                {props.head.review.authorName}
              </p>
              <p class="assumed-count">
                {said("confirmed")} confirmed · {said("corrected")} corrected · {said("wrong")}{" "}
                wrong{open() > 0 ? ` · ${open()} open` : ""}
              </p>
            </div>
          )}
        </Show>
      )}
    </Appear>
  );
}
