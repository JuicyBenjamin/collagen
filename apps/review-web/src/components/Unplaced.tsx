import { For, Show } from "solid-js";
import type { DraftView } from "../data";
import { hostNow } from "../hostNow";

const where = (d: DraftView) => `${d.file}:${d.startLine !== undefined ? `${d.startLine}–` : ""}${d.line}${d.side === "LEFT" ? " (old)" : ""}`;

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
            {(d) => (
              <li>
                <span class={hostNow.isDraft(d) ? "draft-badge" : "pending-badge"}>{hostNow.isDraft(d) ? "Draft from your AI" : d.posted ? "On GitHub" : "Pending"}</span>
                <code>{where(d)}</code>
                <span class="unplaced-body">{d.body}</span>
                <Show when={!d.posted}>
                  <button type="button" class="quiet small" onClick={() => void (hostNow.isDraft(d) ? hostNow.decline([d.id]) : hostNow.unpend([d.id]))}>
                    {hostNow.isDraft(d) ? "Decline" : "Delete"}
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
