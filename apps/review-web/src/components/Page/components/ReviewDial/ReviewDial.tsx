import { createSignal, For, Show, type Element } from "solid-js";
import type { ReviewPageHead, Verdict as VerdictValue } from "~/data";
import { Appear } from "~/components/Appear";
import { flies, floating } from "~/floating";
import { hostNow } from "~/hostNow";
import { viewed } from "~/viewedNow";
import { Count } from "../Header/components/HostBar/components/Progress";
import { Accept } from "./components/Accept";
import { ArrowRound, CommentBox, ThumbsUp } from "./components/Icons";
import { Verdict } from "./components/Verdict";

// Finishing the review, from wherever the reader is: three round buttons —
// comment, request changes, approve — right of how many files they have
// viewed. In the header's bar at the top; once that has scrolled away, in
// the corner, the count's pill and the buttons held in one pill around them. Each opens its panel with that verdict, under
// the bar or above the corner. On a review the reader filed, approving is
// accepting it (or dropping it). Pending comments go with whichever is
// sent; their count sits on the comment button.

const CHOICES: ReadonlyArray<{ readonly verdict: VerdictValue; readonly tone: string; readonly title: string; readonly icon: () => Element }> = [
  { verdict: "comment", tone: "say", title: "Comment", icon: CommentBox },
  { verdict: "request-changes", tone: "change", title: "Request changes", icon: ArrowRound },
  { verdict: "approve", tone: "go", title: "Approve", icon: ThumbsUp },
];

/** The verdict whose panel is open: one for the page, wherever its buttons are. */
const [open, setOpen] = createSignal<VerdictValue | null>(null);

/** Whether the reader can finish a review here: an open review ticket
 *  always — someone else's with a verdict, their own accepted or dropped —
 *  else a pull request they can write to, or comments pending. */
const canReview = (head: ReviewPageHead) =>
  (head.ticket.kind === "review" && !head.ticket.closed) || hostNow.canWrite() || hostNow.pending().length > 0;

/** The three buttons. */
export function DialButtons(props: { head: ReviewPageHead }) {
  const pending = () => hostNow.pending().length;
  return (
    <Appear when={canReview(props.head)}>
      {() => (
      <div class="dial-buttons">
        <For each={CHOICES}>
          {(choice) => (
            <button
              type="button"
              class={["dial", choice.tone, { on: open() === choice.verdict }]}
              onClick={() => setOpen(open() === choice.verdict ? null : choice.verdict)}
              aria-expanded={open() === choice.verdict ? "true" : "false"}
              title={choice.title}
              aria-label={choice.title}
            >
              <choice.icon />
              <Show when={choice.verdict === "comment" && pending() > 0}>
                <span class="dial-count">{pending()}</span>
              </Show>
            </button>
          )}
        </For>
      </div>
      )}
    </Appear>
  );
}

/** The open verdict's panel, where its buttons are: under the bar, or
 *  above the corner. */
export function DialPanel(props: { head: ReviewPageHead; where: "bar" | "corner" }) {
  const here = () => (props.where === "corner") === floating();
  return (
    <Appear when={here() && open()}>
      {(verdict) => (
        <div class={["dial-panel", `in-${props.where}`]}>
          <Show when={props.head.ticket.mine && verdict() === "approve"} fallback={<Verdict verdict={verdict()} onDone={() => setOpen(null)} />}>
            <Accept onDone={() => setOpen(null)} />
          </Show>
        </div>
      )}
    </Appear>
  );
}

/** The corner, once the header's pill has scrolled away: the same pill —
 *  the count's own and the buttons, held in one — with the open panel above
 *  it. It flies here from the header as one view transition; with none, it
 *  opens in. Fixed: nothing on the page moves when it comes. */
export function Corner(props: { head: ReviewPageHead }) {
  const when = () => floating() && (viewed.count().files > 0 || canReview(props.head));
  const body = () => (
    <div class="corner">
      <DialPanel head={props.head} where="corner" />
      <div class="pill-outer floats" style={{ "view-transition-name": "review-pill" }} role="status">
        <Show when={viewed.count().files > 0}>
          <span class="pill-inner">
            <Count />
          </span>
        </Show>
        <DialButtons head={props.head} />
      </div>
    </div>
  );
  return flies ? <Show when={when()}>{body()}</Show> : <Appear when={when()}>{body}</Appear>;
}
