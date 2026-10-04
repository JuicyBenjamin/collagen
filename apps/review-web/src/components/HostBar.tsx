import { createSignal, Show } from "solid-js";
import { hostNow } from "../hostNow";
import { ReviewComposer } from "./ReviewComposer";

/** Top right of the page: the review's pull request (its number, state and
 *  decision, a link to it), a Review button when the reader can review it,
 *  and who is signed in to its host — so whose name a review goes out under
 *  is seen before anything is sent. Each missing part says why, quietly. */
export function HostBar() {
  const [open, setOpen] = createSignal(false);
  const host = hostNow.host;
  const pending = () => hostNow.pending().length;
  // the review can be finished where it can go somewhere: an open pull
  // request, or — with comments pending — the room alone
  const canReview = () => hostNow.canWrite() || pending() > 0;
  return (
    <div class="host-bar">
      <div class="host-row">
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
      <Show when={open() && canReview()}>
        <ReviewComposer onDone={() => setOpen(false)} />
      </Show>
    </div>
  );
}
