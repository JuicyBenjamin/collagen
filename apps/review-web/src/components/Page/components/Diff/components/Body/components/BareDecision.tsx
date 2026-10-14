import { Show } from "solid-js";
import { NO_TITLE, type Decision } from "~/data";
import { animateDetails } from "~/fold";
import { wide } from "~/wide";
import { DecisionWhy } from "../../DecisionWhy";

/** A decision on a review read without a diff: its words, and in place of
 *  its code why there is none — never an empty block. */
export function BareDecision(props: { decision: Decision; why: string }) {
  return (
    <section class="decision" id={props.decision.id}>
      <div class="decision-head">
        <h2 class={{ untitled: !props.decision.title }}>{props.decision.title ?? NO_TITLE}</h2>
        <p class="decision-what">{props.decision.what}</p>
      </div>
      <div class="decision-main">
        <div class="no-code">
          <p class="no-code-why">No code: {props.why}</p>
          <Show when={props.decision.where.length > 0}>
            <p class="empty">{props.decision.where.join(", ")}</p>
          </Show>
        </div>
      </div>
      <details class="why" open={wide()} ref={animateDetails}>
        <summary>Why</summary>
        <div>
          <DecisionWhy decision={props.decision} />
        </div>
      </details>
    </section>
  );
}
