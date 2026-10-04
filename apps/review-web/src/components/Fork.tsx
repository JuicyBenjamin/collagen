import { Show } from "solid-js";
import type { Fork as ForkData } from "../data";
import { assumedNow } from "../assumedNow";

/** A fork in the road: what was chosen over what, why, and whose call — or,
 *  on a review built from assumptions, a turn the AI thinks was taken, and
 *  what that rests on. */
export function Fork(props: { fork: ForkData }) {
  return (
    <div class={["fork", { assumed: assumedNow.isGuess(props.fork), wrong: props.fork.verdict === "wrong" }]} title={props.fork.at}>
      <p class="who">
        Fork in the road
        {assumedNow.isGuess(props.fork)
          ? ` · assumed${props.fork.confidence ? `, ${props.fork.confidence} confidence` : ""}`
          : props.fork.verdict
            ? ` · guessed, ${props.fork.verdict === "confirmed" ? "confirmed" : props.fork.verdict === "corrected" ? "corrected" : "wrong"} by ${assumedNow.claimedBy() ?? "its author"}`
          : props.fork.by
            ? ` · ${props.fork.by === "user" ? "the person's call" : "the agent's call"}`
            : ""}
      </p>
      <p>
        Chose <strong>{props.fork.chose}</strong> over {props.fork.instead}.
      </p>
      <p class="fork-why">{props.fork.why}</p>
      <Show when={assumedNow.isGuess(props.fork) && props.fork.basis}>
        <p class="fork-basis">Rests on: {props.fork.basis}</p>
      </Show>
      <Show when={props.fork.guess}>{(g) => <p class="fork-basis">The AI had guessed: {g().what}{g().why ? ` — ${g().why}` : ""}</p>}</Show>
    </div>
  );
}
