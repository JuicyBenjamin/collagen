import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { hostNow } from "../hostNow";
import { ticketId } from "../ticket";
import { viewed } from "../viewedNow";
import { arrive } from "../wipe";
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
  const watch = (element: HTMLElement) => {
    seen?.disconnect();
    seen = new IntersectionObserver(([entry]) => setAway(!entry!.isIntersecting));
    seen.observe(element);
  };
  onCleanup(() => seen?.disconnect());
  const host = hostNow.host;
  const pending = () => hostNow.pending().length;
  // the review can be finished where it can go somewhere: an open pull
  // request, or — with comments pending — the room alone
  const canReview = () => hostNow.canWrite() || pending() > 0;
  // what it says now, kept for the next open's placeholder
  createEffect(
    () => host(),
    (hostState) => {
      if (!hostState) return;
      keepSaid({
        pull: hostState.pull ? { chip: chipText(hostState.pull) } : { note: hostState.noPull ?? "" },
        viewer: hostState.viewer ? (hostState.viewer.name ?? hostState.viewer.login) : `Not signed in to ${hostState.host}`,
      });
    },
  );
  return (
    <div class="host-bar">
      <div class="host-row">
        {/* how far through the files the reader is, as GitHub's toolbar has it */}
        {/* each part holds its place while it is read: the files' count waits on
            the diff, the rest on the host (a block the size of each, no borders) */}
        <Show when={viewed.read()} fallback={<ProgressPlaceholder />}>
          <Show when={viewed.count().files > 0}>
            <span
              ref={(element) => {
                watch(element);
                arrive(element);
              }}
            >
              <Progress />
            </span>
          </Show>
        </Show>
        <Show when={hostNow.view() === null}>
          <span class="sk" aria-hidden="true">
            {lastSaid && "chip" in lastSaid.pull ? <span class="pull-chip">{words(lastSaid.pull.chip)}</span> : <span class="host-note">{words(lastSaid && "note" in lastSaid.pull ? lastSaid.pull.note : "No pull request yet")}</span>}
          </span>
        </Show>
        <Show when={host()}>
          {(hostState) => (
            <Show when={hostState().pull} fallback={<span class="host-note" ref={arrive}>{hostState().noPull ?? ""}</span>}>
              {(pull) => (
                <a ref={arrive} class={["pull-chip", pull().state]} href={pull().url} target="_blank" rel="noreferrer" title={pull().title}>
                  {chipText(pull())}
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
        <Show when={hostNow.view() === null}>
          <span class="sk viewer" aria-hidden="true">
            <span class="avatar sk-avatar" />
            {words(lastSaid?.viewer ?? "Your name")}
          </span>
        </Show>
        {/* no host to ask, or nobody signed in to it: said in the place a person would be */}
        <Show when={hostNow.view() !== null && !host()}>
          <Nobody label="Not connected" title={(() => {
            const current = hostNow.view();
            return current && "none" in current ? current.none : undefined;
          })()} />
        </Show>
        <Show when={host()}>
          {(hostState) => (
            <Show when={hostState().viewer} fallback={<Nobody label={`Not signed in to ${hostState().host}`} title={hostState().signIn} />}>
              {(me) => (
                <span ref={arrive} class="viewer" title={`Signed in to ${hostState().host} as ${me().login} — a review or comment sent from here goes out under this name`}>
                  <Show when={me().avatarUrl}>{(src) => <img class="avatar" src={src()} alt="" onError={(event) => (event.currentTarget.style.visibility = "hidden")} width={22} height={22} />}</Show>
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

/** What the bar said last time this review was open, kept in this browser:
 *  its placeholder masks those very words, so it is as wide as what comes. */
interface Said {
  /** the pull request chip, or why there is none */
  readonly pull: { readonly chip: string } | { readonly note: string };
  readonly viewer: string;
}
const SAID_KEY = `collagen.hostbar.v1.${ticketId}`;
const lastSaid: Said | null = (() => {
  try {
    const kept = JSON.parse(localStorage.getItem(SAID_KEY) ?? "null") as Partial<Said> | null;
    return kept && typeof kept.viewer === "string" && kept.pull && ("chip" in kept.pull || "note" in kept.pull) ? (kept as Said) : null;
  } catch {
    return null;
  }
})();
const keepSaid = (said: Said): void => {
  try {
    localStorage.setItem(SAID_KEY, JSON.stringify(said));
  } catch {
    // a private window or full storage: the next open guesses the width
  }
};

/** The pull request's chip, as it reads. */
const chipText = (pull: { readonly number: number; readonly draft: boolean; readonly state: string; readonly decision?: string | null }): string =>
  `#${pull.number} · ${pull.draft ? "draft" : pull.state}${pull.decision ? ` · ${pull.decision}` : ""}`;

/** Masked words: a bar the words' size (styles.css: .sk-w). */
const words = (text: string) => <span class="sk-w">{text}</span>;

/** The files' count before the diff is read: its bar and its words. */
function ProgressPlaceholder() {
  return (
    <span class="sk" aria-hidden="true">
      <span class="viewed-progress">
        <span class="bar" />
        {words("0 / 10 files viewed")}
      </span>
    </span>
  );
}

/** Where who is signed in would be, when nobody is: an empty place for the
 *  face, and why, quietly. */
function Nobody(props: { label: string; title: string | undefined }) {
  return (
    <span ref={arrive} class="viewer nobody" title={props.title}>
      <span class="avatar empty" aria-hidden="true" />
      <span class="host-note">{props.label}</span>
    </span>
  );
}

/** How many of the review's files are marked viewed: a count and a bar. */
function Progress() {
  const progress = () => viewed.count();
  return (
    <span class={["viewed-progress", { done: progress().viewed === progress().files }]} title="Files you have marked as viewed">
      <span class="bar" aria-hidden="true">
        <span style={{ width: `${(100 * progress().viewed) / progress().files}%` }} />
      </span>
      {progress().viewed} / {progress().files} files viewed
    </span>
  );
}
