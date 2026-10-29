import { createSignal, flush, For, Show } from "solid-js";
import type { MergeFor, ReviewPageHead, TicketRef } from "~/data";
import { closeParent, closeReview, reviewParents, takeReview } from "~/api";
import { KindIcon } from "~/components/KindIcon";
import { hostNow } from "~/hostNow";
import { mergeNow } from "~/mergeNow";
import { ticketId } from "~/ticket";

/** What Accept does at the review's merge level, said on the button itself:
 *  closed now, or approved for collagen to merge (and close) once it can. */
const DOES: Record<MergeFor, string> = {
  off: "Accept and close ticket",
  theirs: "Accept and close ticket",
  mine: "Accept and merge",
  both: "Accept and merge",
};

/** What this review is to a ticket it grew from, by that ticket's kind: the
 *  word between them on the tree, so the row reads as a sentence. */
const IS_TO: Record<TicketRef["kind"], string> = {
  bug: "fixes",
  plan: "carries out",
  proposal: "builds",
  task: "does",
  review: "follows",
  epic: "is part of",
};

/** A review the reader filed, accepted. Whether collagen merges it is set
 *  ahead, beside its pull request; here it is only told. With a merge
 *  waiting on their accept, Accept approves it and collagen merges and
 *  closes it once it can; otherwise Accept closes it as done. Comments still
 *  pending in it are said first, in the room. What it grew from, still open
 *  and theirs, they may close too — an action they tick, never a question,
 *  ticked to begin with unless their setting says otherwise, and nothing
 *  closed that is not ticked when they accept. */
export function Accept(props: { head: ReviewPageHead; onDone: () => void }) {
  const [sending, setSending] = createSignal(false);
  const [said, setSaid] = createSignal<string | null>(null);
  const count = () => hostNow.pending().length;
  const effect = (): MergeFor => mergeNow.view()?.effect ?? "off";
  const approves = () => effect() === "mine" || effect() === "both";
  const [parents, setParents] = createSignal<ReadonlyArray<TicketRef>>([]);
  const [alsoClose, setAlsoClose] = createSignal<ReadonlySet<string>>(new Set());
  // ticked to begin with when the person's setting says so (alsoCloseParents)
  void reviewParents(ticketId).then(
    (offered) => {
      setParents(offered.tickets);
      if (offered.ticked) setAlsoClose(new Set(offered.tickets.map((parent) => parent.id)));
    },
    () => setParents([]),
  );
  const tick = (id: string) =>
    setAlsoClose((ticked) => {
      const next = new Set(ticked);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const allTicked = () => parents().length > 0 && parents().every((parent) => alsoClose().has(parent.id));
  /** every one ticked, or (all ticked already) none */
  const tickAll = () => setAlsoClose(allTicked() ? new Set<string>() : new Set(parents().map((parent) => parent.id)));
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
      <Show when={!approves() && parents().length > 0}>
        {/* this review, and what it grew from on branches under it, each
            row a sentence — "This review … fixes ⚑ …" — with a box to close
            it too, and, with several, a word that ticks them all */}
        <div class="accept-tree">
          <div class="accept-self">
            <KindIcon kind="review" />
            <span class="accept-title">This review</span>
            {/* the boxes' own column: "all" sits centred over them */}
            <span class="accept-slot">
              <Show when={parents().length > 1}>
                <button type="button" class="accept-all" onClick={tickAll}>
                  {allTicked() ? "none" : "all"}
                </button>
              </Show>
            </span>
          </div>
          <ul class="accept-parents">
            <For each={parents()}>
              {(parent) => (
                <li>
                  <label class="accept-parent">
                    <span class="accept-is">{IS_TO[parent.kind]}</span>
                    <KindIcon kind={parent.kind} />
                    <span class="accept-title">{parent.title}</span>
                    <span class="accept-slot">
                      <input type="checkbox" class="checkbox checkbox-xs" checked={alsoClose().has(parent.id)} onChange={() => tick(parent.id)} />
                    </span>
                  </label>
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>
      <Show when={said()}>{(why) => <p class="host-error">{why()}</p>}</Show>
      <div class="composer-actions">
        {/* what ticking adds, said once something is ticked; Accept in the
            approve button's colour, since it is the same act */}
        <span class="accept-also">
          <Show when={alsoClose().size > 0}>
            Also closes {alsoClose().size === 1 ? "1 ticket" : `${alsoClose().size} tickets`}
          </Show>
        </span>
        <button type="button" class="btn btn-sm" onClick={() => props.onDone()}>
          Cancel
        </button>
        <button type="button" class="btn btn-sm accept-go" disabled={sending()} onClick={() => void accept()}>
          {sending() ? "Accepting…" : DOES[effect()]}
        </button>
      </div>
    </div>
  );
}
