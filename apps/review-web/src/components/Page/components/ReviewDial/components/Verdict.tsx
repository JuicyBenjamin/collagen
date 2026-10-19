import { createSignal, flush, Show } from "solid-js";
import type { Verdict as VerdictValue } from "~/data";
import { takeReview } from "~/api";
import { hostNow } from "~/hostNow";
import { ticketId } from "~/ticket";
import { asksForChanges } from "~/strength";

/** What each verdict is called, at the head of its panel. */
export const VERDICT_LABEL: Record<VerdictValue, string> = { approve: "Approve", "request-changes": "Request changes", comment: "Comment" };

/** What a verdict says on the collagen ticket when the reader gave no words. */
const SAID: Record<VerdictValue, string> = { comment: "", approve: "Approved.", "request-changes": "Changes requested — see my comments." };

/** Finishing the reader's review of someone else's change, as GitHub's
 *  "Finish your review" has it: their words on the whole, a verdict, and
 *  every comment pending in it, said at once — the comments in the room, and
 *  on the pull request as one review through their own gh when there is one
 *  to put them on; the verdict and words on the collagen ticket as their
 *  take, as their agent's post-review would. The verdict is the one picked
 *  on the dial; a must comment makes it a request for changes. A comment
 *  goes on the ticket as words alone: it approves nothing. */
export function Verdict(props: { verdict: VerdictValue; onDone: () => void }) {
  const [body, setBody] = createSignal("");
  const [sending, setSending] = createSignal(false);
  const [said, setSaid] = createSignal<string | null>(null);
  const count = () => hostNow.pending().length;
  const pull = () => hostNow.host()?.pull ?? null;
  const onHost = () => hostNow.canWrite();
  /** a must in the review asks for changes: the whole review does, the host having one verdict for all of it */
  const musts = () => hostNow.pending().filter((draft) => asksForChanges(draft.body)).length;
  const chosen = (): VerdictValue => (musts() > 0 ? "request-changes" : props.verdict);
  // words are needed only where nothing else says it: a verdict or comments do
  const ready = () => !sending() && (chosen() === "approve" || body().trim().length > 0 || count() > 0);
  // one finish at a time: a second click while one is on its way sends nothing
  let busy = false;
  const send = async () => {
    if (busy || !ready()) return;
    busy = true;
    setSending(true);
    setSaid(null);
    // shown now: left to the finish's own read, it would show only once it is over
    flush();
    try {
      // the comments, and on the pull request the words and verdict too
      if (onHost() || count() > 0) {
        const result = await hostNow.submit(onHost() ? chosen() : "comment", onHost() ? body() : "");
        if ("error" in result) {
          // its words and verdict reached the pull request: only the room is left to tell
          if (result.onHost) setBody("");
          return setSaid(result.error);
        }
      }
      // the verdict and words on the collagen ticket, as the reader's take
      const findings = body().trim() || SAID[chosen()] || (count() > 0 ? "See my comments on the code." : "");
      if (findings) {
        const taken = await takeReview(ticketId, findings, chosen() === "request-changes", chosen() === "comment");
        if ("error" in taken) return setSaid(taken.error);
      }
      setBody("");
      props.onDone();
    } catch (error) {
      setSaid(String(error));
    } finally {
      busy = false;
      setSending(false);
    }
  };
  return (
    <form
      class="review-composer"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <div class="composer-head">
        <strong>{VERDICT_LABEL[chosen()]}</strong>
        <span>{count() === 0 ? "no comments pending" : count() === 1 ? "1 comment pending" : `${count()} comments pending`}</span>
      </div>
      <textarea
        placeholder={chosen() === "approve" || count() > 0 ? "Anything to add (optional)" : chosen() === "request-changes" ? "What should change" : "Leave a comment"}
        value={body()}
        onInput={(event) => setBody(event.currentTarget.value)}
        rows={4}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void send();
        }}
      />
      <Show when={musts() > 0}>
        <p class="host-note left">{musts() === 1 ? "A must comment requests changes." : `${musts()} must comments request changes.`}</p>
      </Show>
      <Show when={!onHost()}>
        <p class="host-note left">{pull()?.mine ? `Your own pull request: it all stays in collagen.` : "No open pull request: it all goes on the ticket, in the room."}</p>
      </Show>
      <Show when={hostNow.unplaced().filter((draft) => !hostNow.isDraft(draft)).length}>
        {(stranded) => <p class="host-note left">{stranded() === 1 ? "1 pending comment sits" : `${stranded()} pending comments sit`} on lines this diff no longer shows — listed at the top of the page, to delete.</p>}
      </Show>
      <Show when={said()}>{(why) => <p class="host-error">{why()}</p>}</Show>
      <div class="composer-actions">
        <Show when={count() > 0}>
          <button type="button" class="quiet discard" onClick={() => void hostNow.unpend(null)} title="Take every pending comment out of the review — said nowhere">
            Discard review
          </button>
        </Show>
        <button type="button" class="quiet" onClick={() => props.onDone()}>
          Cancel
        </button>
        <button type="submit" class="banner-go" disabled={!ready()}>
          {sending() ? "Submitting…" : "Submit review"}
        </button>
      </div>
    </form>
  );
}
