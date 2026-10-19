import { Show } from "solid-js";
import { Accept } from "./components/Accept";
import { Verdict } from "./components/Verdict";

/** Finishing a review on its page, by whose it is: on one the reader filed,
 *  accepting it (closed as done) or dropping it; on someone else's, their
 *  verdict and words — on the collagen ticket as their take, and on the
 *  pull request too when there is one to put them on. */
export function ReviewComposer(props: { mine: boolean; onDone: () => void }) {
  return (
    <Show when={props.mine} fallback={<Verdict onDone={props.onDone} />}>
      <Accept onDone={props.onDone} />
    </Show>
  );
}
