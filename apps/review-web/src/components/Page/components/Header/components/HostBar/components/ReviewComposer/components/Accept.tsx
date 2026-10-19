import { createSignal, flush, Show } from "solid-js";
import { closeReview } from "~/api";
import { hostNow } from "~/hostNow";
import { ticketId } from "~/ticket";

/** A review the reader filed, finished: accepted — closed as done — or
 *  dropped. Comments still pending in it are said first, in the room. */
export function Accept(props: { onDone: () => void }) {
  const [sending, setSending] = createSignal<"done" | "dropped" | null>(null);
  const [said, setSaid] = createSignal<string | null>(null);
  const count = () => hostNow.pending().length;
  // one at a time: a second click while one is on its way sends nothing
  let busy = false;
  const finish = async (outcome: "done" | "dropped") => {
    if (busy) return;
    busy = true;
    setSending(outcome);
    setSaid(null);
    flush();
    try {
      if (count() > 0) {
        const comments = await hostNow.submit("comment", "");
        if ("error" in comments) return setSaid(comments.error);
      }
      const closed = await closeReview(ticketId, outcome);
      if ("error" in closed) return setSaid(closed.error);
      props.onDone();
    } catch (error) {
      setSaid(String(error));
    } finally {
      busy = false;
      setSending(null);
    }
  };
  return (
    <div class="review-composer">
      <div class="composer-head">
        <strong>Your review</strong>
        <span>{count() === 0 ? "no comments pending" : count() === 1 ? "1 comment pending, said first" : `${count()} comments pending, said first`}</span>
      </div>
      <p class="host-note left">Accept closes it as done; drop closes it as not done.</p>
      <Show when={said()}>{(why) => <p class="host-error">{why()}</p>}</Show>
      <div class="composer-actions">
        <button type="button" class="quiet" onClick={() => props.onDone()}>
          Cancel
        </button>
        <button type="button" class="quiet" disabled={sending() !== null} onClick={() => void finish("dropped")}>
          {sending() === "dropped" ? "Dropping…" : "Drop"}
        </button>
        <button type="button" class="banner-go" disabled={sending() !== null} onClick={() => void finish("done")}>
          {sending() === "done" ? "Accepting…" : "Accept"}
        </button>
      </div>
    </div>
  );
}
