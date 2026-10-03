import { For, Show } from "solid-js";
import { hostNow } from "../hostNow";

/** What the reader's AI drafted on this change, waiting on the reader: how
 *  many, a way to the first, and all of them posted or declined at once —
 *  each also sits beside its code, to take one by one. */
export function DraftsBar() {
  const waiting = () => hostNow.drafts();
  const first = () => {
    const d = waiting()[0];
    if (d) document.getElementById(`draft-${d.id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  };
  return (
    <Show when={waiting().length > 0}>
      <div class="drafts-bar" role="status">
        <span>
          Your AI drafted <strong>{waiting().length === 1 ? "1 comment" : `${waiting().length} comments`}</strong> on this change — they sit beside the code, for you to accept, edit or decline.
        </span>
        <button type="button" class="quiet small" onClick={first}>
          Show the first
        </button>
        <button type="button" class="quiet small" onClick={() => void hostNow.decline(null)}>
          Decline all
        </button>
        <button type="button" class="banner-go" onClick={() => void hostNow.accept(null)} title="Say them all as yours: in the room, and on the pull request when there is one">
          Post all
        </button>
      </div>
    </Show>
  );
}
