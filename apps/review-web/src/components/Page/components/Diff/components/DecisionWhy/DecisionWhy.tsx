import { Show } from "solid-js";
import { NO_TITLE, type Decision } from "~/data";
import { assumedNow } from "~/assumedNow";
import { AssumedMark, AssumedWhy, VerdictMark } from "./components/Assumption";
import { ToldWhy } from "./components/ToldWhy";

/** A decision's own words: its headline, what was done, what guided it,
 *  how the person steered it and what the agent reasoned. */
export function DecisionWhy(props: { decision: Decision }) {
  return (
    <>
      <Show
        when={assumedNow.isGuess(props.decision)}
        fallback={<VerdictMark verdict={props.decision.verdict} />}
      >
        <AssumedMark
          {...(props.decision.confidence ? { confidence: props.decision.confidence } : {})}
        />
      </Show>
      <p
        class={[
          "why-title",
          { untitled: !props.decision.title, wrong: props.decision.verdict === "wrong" },
        ]}
      >
        {props.decision.title ?? NO_TITLE}
      </p>
      <p class={["why-what", { wrong: props.decision.verdict === "wrong" }]}>
        {props.decision.what}
      </p>
      <Show
        when={assumedNow.isGuess(props.decision)}
        fallback={<ToldWhy decision={props.decision} />}
      >
        <AssumedWhy decision={props.decision} />
      </Show>
      <Show when={props.decision.guess}>
        {(guess) => (
          <div class="why-part guessed">
            <p class="who">The AI had guessed</p>
            <p>
              {guess().what}
              {guess().why ? ` — ${guess().why}` : ""}
            </p>
          </div>
        )}
      </Show>
    </>
  );
}
