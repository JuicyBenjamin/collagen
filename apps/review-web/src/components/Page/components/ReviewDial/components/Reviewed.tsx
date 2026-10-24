import { Show } from "solid-js";
import { Appear } from "~/components/Appear";
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

/** "3 comments", for a review the reader finished by commenting. */
const counted = (yours: YourReview): string =>
  yours.as === "commented" && yours.comments ? ` · ${yours.comments} ${yours.comments === 1 ? "comment" : "comments"}` : "";

/** The reader's finished review, where they finished it: their verdict and
 *  when (and, commented, how many comments). It stands until the change
 *  moves after it. While it stands in for the buttons, pressing it brings
 *  them back for another review, and pressing it again puts them away;
 *  otherwise it only says. Beside the buttons it is `compact`: its mark
 *  alone, the words easing away into its title, so the pill stays narrow. */
export function Reviewed(props: { yours: YourReview; again: boolean; pressable: boolean; compact: boolean; onAgain: () => void }) {
  const text = () => `${SAID[props.yours.as]}${counted(props.yours)} · ${ago(props.yours.at, hostNow.now())}`;
  const label = () => (props.pressable ? `${text()} — ${props.again ? "put the buttons away" : "review again"}` : text());
  return (
    <Show
      when={props.pressable}
      fallback={
        <span class={["reviewed", TONE[props.yours.as], { compact: props.compact }]} title={props.compact ? text() : undefined} aria-label={props.compact ? text() : undefined}>
          <Check />
          <Appear way="across" when={!props.compact}>{() => <span class="reviewed-words">{text()}</span>}</Appear>
        </span>
      }
    >
      <button
        type="button"
        class={["reviewed", TONE[props.yours.as], { on: props.again, compact: props.compact }]}
        onClick={() => props.onAgain()}
        aria-expanded={props.again ? "true" : "false"}
        title={label()}
        aria-label={props.compact ? label() : undefined}
      >
        <Check />
        <Appear way="across" when={!props.compact}>{() => <span class="reviewed-words">{text()}</span>}</Appear>
      </button>
    </Show>
  );
}
