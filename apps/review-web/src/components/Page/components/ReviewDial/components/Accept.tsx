import { createSignal, flush, For, Show } from "solid-js";
import type { MergeFor, MergeView } from "~/data";
import { closeReview, mergeView, setMerge, takeReview } from "~/api";
import { hostNow } from "~/hostNow";
import { ticketId } from "~/ticket";

const LEVELS: ReadonlyArray<{ readonly value: MergeFor; readonly label: string }> = [
  { value: "off", label: "never" },
  { value: "theirs", label: "when someone else approves" },
  { value: "mine", label: "when I accept" },
  { value: "both", label: "when they approve and I accept" },
];
const labelOf = (level: MergeFor) => LEVELS.find((option) => option.value === level)!.label;

/** What Accept does at a merge level, in a line. */
const NOTES: Record<MergeFor, string> = {
  off: "Accept closes it as done; drop closes it as not done.",
  theirs: "Collagen merges it once someone else approves it. Accept closes it as done now, unmerged; drop closes it as not done.",
  mine: "Accept approves it: collagen merges it once its checks pass, then closes it.",
  both: "Accept approves it: collagen merges it once someone else approves it too and its checks pass, then closes it.",
};

/** A review the reader filed, finished: accepted or dropped — and whether
 *  collagen merges it for them, its own setting or its room's. With a merge
 *  waiting on their accept, Accept approves it and collagen merges and
 *  closes it once it can; otherwise Accept closes it as done. Comments still
 *  pending in it are said first, in the room. */
export function Accept(props: { onDone: () => void }) {
  const [sending, setSending] = createSignal<"done" | "dropped" | null>(null);
  const [said, setSaid] = createSignal<string | null>(null);
  const [merging, setMerging] = createSignal<MergeView | null>(null);
  void mergeView(ticketId).then(setMerging, () => setMerging(null));
  const count = () => hostNow.pending().length;
  const effect = (): MergeFor => merging()?.effect ?? "off";
  const approves = () => effect() === "mine" || effect() === "both";
  const choose = async (value: string) => {
    const level = value === "room" ? null : (value as MergeFor);
    const view = await setMerge(ticketId, level).catch(() => null);
    if (view) setMerging(view);
  };
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
      // approved, to be merged when it can be — or closed now
      const result = outcome === "done" && approves() ? await takeReview(ticketId, "Accepted.", false) : await closeReview(ticketId, outcome);
      if ("error" in result) return setSaid(result.error);
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
      <Show when={merging()}>
        {(view) => (
          <label class="merge-for">
            Merge for me
            <select class="select select-sm" value={view().own ?? "room"} onChange={(event) => void choose(event.currentTarget.value)}>
              <option value="room">as the room: {labelOf(view().room)}</option>
              <For each={LEVELS}>{(option) => <option value={option.value}>{option.label}</option>}</For>
            </select>
          </label>
        )}
      </Show>
      <p class="host-note left">{NOTES[effect()]}</p>
      <Show when={said()}>{(why) => <p class="host-error">{why()}</p>}</Show>
      <div class="composer-actions">
        <button type="button" class="btn btn-sm" onClick={() => props.onDone()}>
          Cancel
        </button>
        <button type="button" class="btn btn-sm" disabled={sending() !== null} onClick={() => void finish("dropped")}>
          {sending() === "dropped" ? "Dropping…" : "Drop"}
        </button>
        <button type="button" class="btn btn-primary btn-sm" disabled={sending() !== null} onClick={() => void finish("done")}>
          {sending() === "done" ? "Accepting…" : "Accept"}
        </button>
      </div>
    </div>
  );
}
