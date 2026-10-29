import { createSignal, For, Show, type Element } from "solid-js";
import type { ReviewPageHead, Verdict as VerdictValue } from "~/data";
import { Appear } from "~/components/Appear";
import { flies, floating } from "~/floating";
import { hostNow } from "~/hostNow";
import { viewed } from "~/viewedNow";
import { yourReview } from "~/yourReview";
import { Count } from "../Header/components/HostBar/components/Progress";
import { Accept } from "./components/Accept";
import { ArrowRound, CommentBox, ThumbsUp } from "./components/Icons";
import { Reviewed } from "./components/Reviewed";
import { Verdict } from "./components/Verdict";

// Finishing the review, from wherever the reader is: three round buttons —
// comment, request changes, approve — right of how many files they have
// viewed. In the header's bar at the top; once that has scrolled away, in
// the corner, the count's pill and the buttons held in one pill around them. Each opens its panel with that verdict, under
// the bar or above the corner. On a review the reader filed, approving is
// accepting it (or dropping it). Pending comments go with whichever is
// sent; their count sits on the comment button. Once the reader has
// finished a review, what they gave and when stands in for the buttons
// until the change moves after it; the buttons come back then, when
// comments are pending, or on the reader's word — sliding in across the
// pill as the finish goes, not folding.

const CHOICES: ReadonlyArray<{ readonly verdict: VerdictValue; readonly tone: string; readonly title: string; readonly icon: () => Element }> = [
  { verdict: "comment", tone: "say", title: "Comment", icon: CommentBox },
  { verdict: "request-changes", tone: "change", title: "Request changes", icon: ArrowRound },
  { verdict: "approve", tone: "go", title: "Approve", icon: ThumbsUp },
];

/** The verdict whose panel is open: one for the page, wherever its buttons are. */
const [open, setOpen] = createSignal<VerdictValue | null>(null);

/** The finish the reader asked to review again after (its time): one for
 *  the page, like `open`. A new finish puts the buttons away again. */
const [again, setAgain] = createSignal<number | null>(null);

/** The reader's own finish of the review: the room's or the host's, the later. */
const yours = (head: ReviewPageHead) => yourReview(head.ticket.yours, hostNow.host());

/** Whether the reader can finish a review here: an open review ticket
 *  always — someone else's with a verdict, their own accepted or dropped —
 *  else a pull request they can write to, or comments pending. */
const canReview = (head: ReviewPageHead) =>
  (head.ticket.kind === "review" && !head.ticket.closed) || hostNow.canWrite() || hostNow.pending().length > 0;

/** The three buttons — and, once the reader has finished a review, what
 *  they gave, in their place until another is due. */
export function DialButtons(props: { head: ReviewPageHead }) {
  const pending = () => hostNow.pending().length;
  /** the reader's finish while it stands: until the change moves after it,
   *  when there is something new to read and the buttons are back */
  const done = () => {
    const finish = yours(props.head);
    return finish && !finish.since ? finish : null;
  };
  /** comments wait to be said */
  const due = () => pending() > 0;
  // a panel open stays with its buttons until it is done
  const shown = () => canReview(props.head) && (done() === null || due() || again() === done()?.at || open() !== null);
  // the finish and the buttons trade places across the pill, one sliding in as the other goes
  return (
    <>
      <Appear way="across" when={done()}>
        {(finish) => (
          <Reviewed
            yours={finish()}
            again={again() === finish().at}
            pressable={canReview(props.head) && !due()}
            compact={shown()}
            onAgain={() => {
              const asked = again() === finish().at;
              setAgain(asked ? null : finish().at);
              if (asked) setOpen(null);
            }}
          />
        )}
      </Appear>
      <Appear way="across" when={shown()}>
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
    </>
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
            <Accept head={props.head} onDone={() => setOpen(null)} />
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
  const when = () => floating() && (viewed.count().files > 0 || canReview(props.head) || yours(props.head) !== null);
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
