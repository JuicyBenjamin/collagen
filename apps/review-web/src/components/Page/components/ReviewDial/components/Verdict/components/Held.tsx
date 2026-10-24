import { For, Show } from "solid-js";
import type { DraftView } from "~/data";
import { Appear } from "~/components/Appear";
import { leave } from "~/fold";
import { hostNow } from "~/hostNow";
import { readStrength } from "~/strength";
import { showTab, tab } from "~/testsNow";
import { reading } from "~/viewedNow";

const where = (comment: DraftView) => `${comment.file}:${comment.startLine !== undefined ? `${comment.startLine}–` : ""}${comment.line}${comment.side === "LEFT" ? " (old)" : ""}`;

/** Comments pending in the review that were written at another commit than
 *  the one the page shows: the review is not submitted until each is kept
 *  where it sits now or deleted. Each is listed with a way to it. */
export function Held(props: { comments: ReadonlyArray<DraftView> }) {
  return (
    <Appear when={props.comments.length > 0}>
      {() => (
        <section class="held" aria-label="Comments to settle before submitting">
          <div class="held-box">
            <p class="held-head">
              <strong>Not submitted yet.</strong> {props.comments.length === 1 ? "1 comment was" : `${props.comments.length} comments were`} written on another commit: keep or delete each first.
            </p>
            <ul>
              <For each={props.comments}>{(comment) => <Row comment={comment} />}</For>
            </ul>
          </div>
        </section>
      )}
    </Appear>
  );
}

/** One held comment: where it sits (a way there), what it says, and keep or delete. */
function Row(props: { comment: DraftView }) {
  let row: HTMLLIElement | undefined;
  // on no line the diff shows: there is nowhere to keep it, only to delete it
  const placed = () => !hostNow.unplaced().some((other) => other.id === props.comment.id);
  const go = () => {
    const away = tab() !== "code";
    if (away) showTab("code");
    const folded = reading.folded(props.comment.file);
    if (folded) reading.toggle(props.comment.file);
    setTimeout(
      () => {
        const at = document.getElementById(placed() ? `pending-${props.comment.id}` : "unplaced");
        if (!at) return;
        at.scrollIntoView({ block: "center", behavior: "smooth" });
        at.classList.remove("flash");
        void at.offsetWidth;
        at.classList.add("flash");
      },
      away || folded ? 250 : 0,
    );
  };
  // it goes from the list before it is taken from the review
  const settle = async (action: () => Promise<unknown>) => {
    await leave(row);
    await action();
  };
  return (
    <li ref={row}>
      <button type="button" class="link" onClick={go} title="Go to it">
        <code>{where(props.comment)}</code>
      </button>
      <span class="held-body">{readStrength(props.comment.body).text}</span>
      <span class="held-actions">
        <Show when={placed()}>
          <button type="button" class="btn btn-xs" onClick={() => void settle(() => hostNow.repin(props.comment.id))} title="It is about these lines at the commit shown now">
            Keep it here
          </button>
        </Show>
        <button type="button" class="btn btn-xs" onClick={() => void settle(() => hostNow.unpend([props.comment.id]))}>
          Delete
        </button>
      </span>
    </li>
  );
}
