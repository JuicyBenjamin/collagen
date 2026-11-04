import { Appear } from "~/components/Appear";
import { hostNow } from "~/hostNow";
import { nearNow } from "~/nearNow";

/** What the reader's AI drafted on this change, waiting on the reader: how
 *  many, a way to the first, and all of them posted or declined at once —
 *  each also sits beside its code, to take one by one. */
export function DraftsBar() {
  const waiting = () => hostNow.drafts();
  const first = async () => {
    // the first under a line; with none, the list of those on no line shown
    const draft = waiting().find((candidate) => !hostNow.unplaced().includes(candidate));
    // its file's code drawn first, wherever it is on the page
    if (draft) await nearNow.reveal(draft.file);
    document.getElementById(draft ? `draft-${draft.id}` : "unplaced")?.scrollIntoView({ block: "center", behavior: "smooth" });
    if (draft) setTimeout(() => nearNow.release(draft.file), 2_000);
  };
  return (
    <Appear when={waiting().length > 0}>
      {() => (
      <div class="drafts-bar" role="status">
        <span>
          Your AI drafted <strong>{waiting().length === 1 ? "1 comment" : `${waiting().length} comments`}</strong> on this change — they sit beside the code, for you to add to your review, edit or decline.
        </span>
        <button type="button" class="btn btn-xs" onClick={first}>
          Show the first
        </button>
        <button type="button" class="btn btn-xs" onClick={() => void hostNow.decline(null)}>
          Decline all
        </button>
        <button type="button" class="btn btn-primary btn-sm" onClick={() => void hostNow.accept(null)} title="Put them all in your review — said with the rest when you finish it">
          Add all to review
        </button>
      </div>
      )}
    </Appear>
  );
}
