import { For, Show } from "solid-js";
import type { DraftView } from "../data";
import { hostNow } from "../hostNow";

const where = (draft: DraftView) => `${draft.file}:${draft.startLine !== undefined ? `${draft.startLine}–` : ""}${draft.line}${draft.side === "LEFT" ? " (old)" : ""}`;

/** Comments not said yet whose line this diff no longer shows — the file
 *  gone, renamed, or its change moved: listed here, each to delete, since
 *  there is no line to find them under. A pending one would otherwise hold
 *  up finishing the review with no way to reach it. */
export function Unplaced() {
  const lost = () => hostNow.unplaced();
  return (
    <Show when={lost().length > 0}>
      <section class="unplaced" id="unplaced" aria-label="Comments not on a line shown">
        <p class="unplaced-head">
          <strong>{lost().length === 1 ? "1 comment" : `${lost().length} comments`}</strong> not said yet sit on lines this diff no longer shows — the code moved under them.
        </p>
        <ul>
          <For each={lost()}>
            {(draft) => (
              <li>
                <span class={hostNow.isDraft(draft) ? "draft-badge" : "pending-badge"}>{hostNow.isDraft(draft) ? "Draft from your AI" : draft.posted ? `On ${hostNow.hostName()}` : "Pending"}</span>
                <code>{where(draft)}</code>
                <span class="unplaced-body">{draft.body}</span>
                <Show when={!draft.posted}>
                  <button type="button" class="quiet small" onClick={() => void (hostNow.isDraft(draft) ? hostNow.decline([draft.id]) : hostNow.unpend([draft.id]))}>
                    {hostNow.isDraft(draft) ? "Decline" : "Delete"}
                  </button>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </section>
    </Show>
  );
}
