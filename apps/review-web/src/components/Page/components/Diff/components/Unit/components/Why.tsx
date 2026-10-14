import { For, Show } from "solid-js";
import type { Decision, Unit } from "~/data";
import { DecisionWhy } from "../../DecisionWhy";
import { Fork } from "../../Fork";

/** The why beside a unit: the decisions that shaped it (one spanning other
 *  units links them), the forks that fall in it, and what no decision
 *  covers — quieter than the code, and on a narrow screen folded away. */
export function Why(props: {
  unit: Unit;
  decisions: ReadonlyArray<Decision>;
  unitsOf: ReadonlyMap<string, ReadonlyArray<Unit>>;
  unmatched: Readonly<Record<string, ReadonlyArray<string>>>;
}) {
  const changes = (count: number) => (count === 1 ? "1 change" : `${count} changes`);
  return (
    <>
      <For each={props.decisions}>
        {(decision) => (
          <div class="why-decision" id={`why-${props.unit.id}-${decision.id}`}>
            <DecisionWhy decision={decision} />
            <Show
              when={(props.unitsOf.get(decision.id) ?? []).filter(
                (unit) => unit.id !== props.unit.id,
              )}
            >
              {(others) => (
                <Show when={others().length > 0}>
                  <p class="also-in">
                    Also shaped{" "}
                    <For each={others()}>
                      {(unit, index) => (
                        <>
                          {index() > 0 ? ", " : ""}
                          <a href={`#${unit.id}`}>{unit.title}</a>
                        </>
                      )}
                    </For>
                  </p>
                </Show>
              )}
            </Show>
            <Show when={props.unmatched[decision.id]}>
              {(missed) => (
                <p class="stale" title={missed().join(", ")}>
                  Also points at code this diff does not change — the why may be older than the
                  branch.
                </p>
              )}
            </Show>
          </div>
        )}
      </For>
      <For each={props.unit.forks}>{(fork) => <Fork fork={fork} />}</For>
      <Show when={props.unit.unexplained.length > 0 && props.unit.by !== "unexplained"}>
        <p class="stale">
          {changes(props.unit.unexplained.length)} here no decision covers — worth a question to the
          author.
        </p>
      </Show>
    </>
  );
}
