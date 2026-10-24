import { Show } from "solid-js";
import type { ReviewedAs, YourReview } from "~/data";
import { ago } from "~/ago";
import { hostNow } from "~/hostNow";
import { Check } from "./Icons";

/** What the reader did, in their words. */
const SAID: Record<ReviewedAs, string> = {
  approved: "You approved",
  "changes requested": "You requested changes",
  commented: "You commented",
  accepted: "You accepted",
  dropped: "You dropped",
};

/** Its colour: the dial's button it came from. */
const TONE: Record<ReviewedAs, string> = {
  approved: "go",
  "changes requested": "change",
  commented: "say",
  accepted: "go",
  dropped: "quiet",
};

/** The reader's finished review, where they finished it: their verdict and
 *  when, and whether the change moved since. While it stands in for the
 *  buttons, pressing it brings them back for another review, and pressing
 *  it again puts them away; otherwise it only says. */
export function Reviewed(props: { yours: YourReview; again: boolean; pressable: boolean; onAgain: () => void }) {
  const text = () => `${SAID[props.yours.as]} · ${ago(props.yours.at, hostNow.now())}${props.yours.since ? " · changed since" : ""}`;
  return (
    <Show
      when={props.pressable}
      fallback={
        <span class={["reviewed", TONE[props.yours.as]]}>
          <Check />
          {text()}
        </span>
      }
    >
      <button
        type="button"
        class={["reviewed", TONE[props.yours.as], { on: props.again }]}
        onClick={() => props.onAgain()}
        aria-expanded={props.again ? "true" : "false"}
        title={props.again ? "Put the buttons away" : "Review again"}
      >
        <Check />
        {text()}
      </button>
    </Show>
  );
}
