import { createSignal, Show } from "solid-js";
import { Appear } from "~/components/Appear";
import { hostNow } from "~/hostNow";
import { Progress } from "./components/Progress";
import { Pull } from "./components/Pull";
import { ReviewComposer } from "./components/ReviewComposer";
import { Viewer } from "./components/Viewer";

/** Top right of the page: how far through the files the reader is, the
 *  review's pull request (its number, state and decision, a link to it), a
 *  Review button when the reader can review it, and who is signed in to its
 *  host — so whose name a review goes out under is seen before anything is
 *  sent. Each part arrives on its own read; each missing part says why, quietly. */
export function HostBar() {
  const [open, setOpen] = createSignal(false);
  const pending = () => hostNow.pending().length;
  // the review can be finished where it can go somewhere: an open pull
  // request, or — with comments pending — the room alone
  const canReview = () => hostNow.canWrite() || pending() > 0;
  return (
    <div class="host-bar">
      <div class="host-row">
        <Progress />
        <Pull />
        <Appear when={canReview()}>
          {() => (
            <button
              type="button"
              class={["review-open", { on: open() }]}
              onClick={() => setOpen(!open())}
              aria-expanded={open() ? "true" : "false"}
              title={
                pending() > 0
                  ? "Finish your review: say the pending comments, with a verdict"
                  : "Review the pull request"
              }
            >
              {pending() > 0 ? `Finish review · ${pending()}` : "Review"}
            </button>
          )}
        </Appear>
        <Viewer />
      </div>
      <Show when={open() && canReview()}>
        <ReviewComposer onDone={() => setOpen(false)} />
      </Show>
    </div>
  );
}

/** The bar before the host and the diff are read: its parts' placeholders. */
HostBar.Skeleton = function Skeleton() {
  return (
    <div class="host-bar">
      <div class="host-row">
        <Progress.Skeleton />
        <Pull.Skeleton />
        <Viewer.Skeleton />
      </div>
    </div>
  );
};
