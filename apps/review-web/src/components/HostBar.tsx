import { createSignal, onCleanup, Show } from "solid-js";
import { hostNow } from "../hostNow";
import { viewed } from "../viewedNow";
import { ReviewComposer } from "./ReviewComposer";

/** Top right of the page: the review's pull request (its number, state and
 *  decision, a link to it), a Review button when the reader can review it,
 *  and who is signed in to its host — so whose name a review goes out under
 *  is seen before anything is sent. Each missing part says why, quietly. */
export function HostBar() {
  const [open, setOpen] = createSignal(false);
  // the progress up here scrolled out of sight: it floats in the corner
  // instead, so how far through the reader is stays in view as they read
  const [away, setAway] = createSignal(false);
  let seen: IntersectionObserver | undefined;
  const watch = (el: HTMLElement) => {
    seen?.disconnect();
    seen = new IntersectionObserver(([e]) => setAway(!e!.isIntersecting));
    seen.observe(el);
  };
  onCleanup(() => seen?.disconnect());
  const host = hostNow.host;
  const pending = () => hostNow.pending().length;
  // the review can be finished where it can go somewhere: an open pull
  // request, or — with comments pending — the room alone
  const canReview = () => hostNow.canWrite() || pending() > 0;
  return (
    <div class="host-bar">
      <div class="host-row">
        {/* how far through the files the reader is, as GitHub's toolbar has it */}
        <Show when={viewed.count().files > 0}>
          <span ref={watch}>
            <Progress />
          </span>
        </Show>
        <Show when={host()}>
          {(h) => (
            <Show when={h().pull} fallback={<span class="host-note">{h().noPull ?? ""}</span>}>
              {(pull) => (
                <a class={["pull-chip", pull().state]} href={pull().url} target="_blank" rel="noreferrer" title={pull().title}>
                  #{pull().number} · {pull().draft ? "draft" : pull().state}
                  {pull().decision ? ` · ${pull().decision}` : ""}
                </a>
              )}
            </Show>
          )}
        </Show>
        <Show when={canReview()}>
          <button type="button" class={["review-open", { on: open() }]} onClick={() => setOpen(!open())} aria-expanded={open() ? "true" : "false"} title={pending() > 0 ? "Finish your review: say the pending comments, with a verdict" : "Review the pull request"}>
            {pending() > 0 ? `Finish review · ${pending()}` : "Review"}
          </button>
        </Show>
        <Show when={host()}>
          {(h) => (
            <Show when={h().viewer} fallback={<span class="host-note" title={h().signIn}>Not signed in to {h().host}</span>}>
              {(me) => (
                <span class="viewer" title={`Signed in to ${h().host} as ${me().login} — a review or comment sent from here goes out under this name`}>
                  <Show when={me().avatarUrl}>{(src) => <img class="avatar" src={src()} alt="" onError={(e) => (e.currentTarget.style.visibility = "hidden")} width={22} height={22} />}</Show>
                  <span class="viewer-name">{me().name ?? me().login}</span>
                </span>
              )}
            </Show>
          )}
        </Show>
      </div>
      <Show when={away() && viewed.count().files > 0}>
        <div class="progress-float" role="status">
          <Progress />
        </div>
      </Show>
      <Show when={open() && canReview()}>
        <ReviewComposer onDone={() => setOpen(false)} />
      </Show>
    </div>
  );
}

/** How many of the review's files are marked viewed: a count and a bar. */
function Progress() {
  const c = () => viewed.count();
  return (
    <span class={["viewed-progress", { done: c().viewed === c().files }]} title="Files you have marked as viewed">
      <span class="bar" aria-hidden="true">
        <span style={{ width: `${(100 * c().viewed) / c().files}%` }} />
      </span>
      {c().viewed} / {c().files} files viewed
    </span>
  );
}
