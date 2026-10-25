import { createSignal, flush, For, Show } from "solid-js";
import type { MergeFor, TicketRef } from "~/data";
import { closeParent, closeReview, reviewParents, takeReview } from "~/api";
import { hostNow } from "~/hostNow";
import { mergeNow } from "~/mergeNow";
import { ticketId } from "~/ticket";

/** What Accept does at the review's merge level, in a line. */
const NOTES: Record<MergeFor, string> = {
  off: "Accept closes it as done.",
  theirs: "Accept closes it as done. Collagen merges it once someone else approves it.",
  mine: "Accept approves it: collagen merges it once its checks pass, then closes it.",
  both: "Accept approves it: collagen merges it once someone else approves it too and its checks pass, then closes it.",
};

/** A review the reader filed, accepted. Whether collagen merges it is set
 *  ahead, beside its pull request; here it is only told. With a merge
 *  waiting on their accept, Accept approves it and collagen merges and
 *  closes it once it can; otherwise Accept closes it as done. Comments still
 *  pending in it are said first, in the room. What it grew from, still open
 *  and theirs, they may close too — an action they tick, never a question,
 *  and nothing closed unless they do. */
export function Accept(props: { onDone: () => void }) {
  const [sending, setSending] = createSignal(false);
  const [said, setSaid] = createSignal<string | null>(null);
  const count = () => hostNow.pending().length;
  const effect = (): MergeFor => mergeNow.view()?.effect ?? "off";
  const approves = () => effect() === "mine" || effect() === "both";
  const [parents, setParents] = createSignal<ReadonlyArray<TicketRef>>([]);
  void reviewParents(ticketId).then(setParents, () => setParents([]));
  const [alsoClose, setAlsoClose] = createSignal<ReadonlySet<string>>(new Set());
  const tick = (id: string) =>
    setAlsoClose((ticked) => {
      const next = new Set(ticked);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  // one at a time: a second click while one is on its way sends nothing
  let busy = false;
  const accept = async () => {
    if (busy) return;
    busy = true;
    setSending(true);
    setSaid(null);
    flush();
    try {
      if (count() > 0) {
        const comments = await hostNow.submit("comment", "");
        if ("error" in comments) return setSaid(comments.error);
      }
      // approved, to be merged when it can be — or closed now
      const result = approves() ? await takeReview(ticketId, "Accepted.", false) : await closeReview(ticketId, "done");
      if ("error" in result) return setSaid(result.error);
      // what it grew from, ticked to close too
      for (const parentId of approves() ? [] : alsoClose()) {
        const closed = await closeParent(ticketId, parentId);
        if ("error" in closed) return setSaid(closed.error);
      }
      props.onDone();
    } catch (error) {
      setSaid(String(error));
    } finally {
      busy = false;
      setSending(false);
    }
  };
  return (
    <div class="review-composer">
      <div class="composer-head">
        <strong>Your review</strong>
        <span>{count() === 0 ? "no comments pending" : count() === 1 ? "1 comment pending, said first" : `${count()} comments pending, said first`}</span>
      </div>
      <p class="host-note left">{NOTES[effect()]}</p>
      <Show when={!approves() && parents().length > 0}>
        <div class="accept-parents">
          <For each={parents()}>
            {(parent) => (
              <label class="label cursor-pointer justify-start gap-2">
                <input type="checkbox" class="checkbox checkbox-sm" checked={alsoClose().has(parent.id)} onChange={() => tick(parent.id)} />
                <span>Also close “{parent.title}”, which this grew from</span>
              </label>
            )}
          </For>
        </div>
      </Show>
      <Show when={said()}>{(why) => <p class="host-error">{why()}</p>}</Show>
      <div class="composer-actions">
        <button type="button" class="btn btn-sm" onClick={() => props.onDone()}>
          Cancel
        </button>
        <button type="button" class="btn btn-primary btn-sm" disabled={sending()} onClick={() => void accept()}>
          {sending() ? "Accepting…" : "Accept"}
        </button>
      </div>
    </div>
  );
}
