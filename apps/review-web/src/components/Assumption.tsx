import { Show } from "solid-js";
import type { Decision } from "../data";
import { assumedNow } from "../assumedNow";

const SURE = { high: "someone said why", medium: "the evidence points there", low: "a hunch from the code" } as const;

/** What a guess rests on and how sure the AI is — in place of the person's
 *  words and the agent's reasons a told decision has. */
export function AssumedWhy(props: { decision: Decision }) {
  return (
    <>
      <Show when={props.decision.basis}>
        {(basis) => (
          <div class="why-part">
            <p class="who">Rests on</p>
            <p class="quote">{basis()}</p>
          </div>
        )}
      </Show>
      <Show when={props.decision.agentWhy}>
        {(why) => (
          <div class="why-part">
            <p class="who">The AI's reading</p>
            <p>{why()}</p>
          </div>
        )}
      </Show>
    </>
  );
}

/** The mark an assumption carries everywhere it is drawn. */
export function AssumedMark(props: { confidence?: "high" | "medium" | "low" }) {
  return (
    <p class="assumed-mark" title={props.confidence ? `${props.confidence} confidence: ${SURE[props.confidence]}` : "inferred, not told"}>
      Assumption{props.confidence ? ` · ${props.confidence} confidence` : ""}
    </p>
  );
}

/** What the code's author made of a guess, once they took the review over. */
export function VerdictMark(props: { verdict?: "confirmed" | "corrected" | "wrong" }) {
  const by = () => assumedNow.claimedBy() ?? "its author";
  return (
    <Show when={props.verdict}>
      {(v) => (
        <p class={["verdict-mark", v()]}>
          {v() === "confirmed" ? `Guessed, confirmed by ${by()}` : v() === "corrected" ? `Guessed wrong, corrected by ${by()}` : `Guessed wrong, says ${by()}`}
        </p>
      )}
    </Show>
  );
}
