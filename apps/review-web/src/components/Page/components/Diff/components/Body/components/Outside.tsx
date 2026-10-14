import { For, Show } from "solid-js";
import type { Decision } from "~/data";
import { animateDetails } from "~/fold";
import { wide } from "~/wide";
import { DecisionWhy } from "../../DecisionWhy";

/** Decisions whose code is in no change here — the why may be older than
 *  the branch, or points at nothing: still shown, with where they point. */
export function Outside(props: {
  decisions: ReadonlyArray<Decision>;
  unmatched: Readonly<Record<string, ReadonlyArray<string>>>;
}) {
  return (
    <Show when={props.decisions.length > 0}>
      <section class="decision" id="outside">
        <div class="decision-head">
          <h2>Decisions outside the diff</h2>
          <p class="decision-what">
            Their code is in no change here — the why may be older than the branch, or points at
            nothing.
          </p>
        </div>
        <div class="decision-main" />
        <details class="why" open={wide()} ref={animateDetails}>
          <summary>Why</summary>
          <div>
            <For each={props.decisions}>
              {(decision) => (
                <div class="why-decision">
                  <DecisionWhy decision={decision} />
                  <p class="stale" title={(props.unmatched[decision.id] ?? []).join(", ")}>
                    {decision.where.length === 0
                      ? "Points at no code."
                      : `Points at code this diff does not change: ${decision.where.join(", ")}`}
                  </p>
                </div>
              )}
            </For>
          </div>
        </details>
      </section>
    </Show>
  );
}
