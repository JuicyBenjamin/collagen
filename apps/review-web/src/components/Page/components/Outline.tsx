import { For, Show } from "solid-js";
import { NO_TITLE, type ReviewPageData, type Unit } from "~/data";
import { Arrives } from "~/components/Arrives";
import { Masked } from "~/components/Masked";
import { viewed } from "~/viewedNow";

/** The outline, once the diff is read: its units, else the decisions alone,
 *  each a link to its section, ticked off as its files are viewed. */
export function Outline(props: { data: ReviewPageData }) {
  /** Every file of a unit marked viewed — the outline ticks it off. */
  const unitViewed = (unit: Unit): boolean => {
    const files = new Set(unit.hunks.map((id) => id.slice(0, id.lastIndexOf("#"))));
    return files.size > 0 && [...files].every((file) => viewed.state(file) === "viewed");
  };
  const changes = (count: number) => (count === 1 ? "1 change" : `${count} changes`);
  /** A group of uses, counted: its files, and those that differ. */
  const usesCount = (unit: Unit, differs: ReadonlyArray<string>) => {
    const count = new Set(unit.hunks.map((id) => id.slice(0, id.lastIndexOf("#")))).size;
    return `${count === 1 ? "1 use" : `${count} uses`}${differs.length > 0 ? ` · ${differs.length} ${differs.length === 1 ? "differs" : "differ"}` : ""}`;
  };
  return (
    <Arrives skeleton={Outline.Skeleton}>
      <p class="nav-title">{props.data.grouped ? "Units" : "Decisions"}</p>
      {/* counted as the diff comes in: it arrives with the outline */}
      <Show when={viewed.count().files > 0 ? viewed.count() : null}>
        {(count) => (
          <p class={["nav-viewed", { done: count().viewed === count().files }]}>
            {count().viewed} of {count().files} files viewed
          </p>
        )}
      </Show>
      <ol>
        <Show
          when={props.data.grouped}
          fallback={
            <For each={props.data.review.decisions}>
              {(decision) => (
                <li>
                  <a href={`#${decision.id}`}>
                    <span class={["nav-what", { untitled: !decision.title }]}>
                      {decision.title ?? NO_TITLE}
                    </span>
                  </a>
                </li>
              )}
            </For>
          }
        >
          {(grouped) => (
            <For each={grouped().units}>
              {(unit) => (
                <li
                  class={{
                    "nav-unexplained": unit.by === "unexplained",
                    "nav-done": unitViewed(unit),
                  }}
                >
                  <a
                    href={`#${unit.id}`}
                    title={unitViewed(unit) ? "Every file here is viewed" : undefined}
                  >
                    <span class="nav-what">
                      <Show when={unitViewed(unit)}>
                        <span class="nav-check">✓ </span>
                      </Show>
                      {unit.title}
                    </span>
                    <span class="count">
                      {unit.uses ? usesCount(unit, unit.uses.differs) : changes(unit.hunks.length)}
                      {unit.unexplained.length > 0
                        ? ` · ${unit.unexplained.length} not explained`
                        : ""}
                    </span>
                  </a>
                </li>
              )}
            </For>
          )}
        </Show>
        <Show when={(props.data.grouped?.outside.length ?? 0) > 0}>
          <li class="nav-unexplained">
            <a href="#outside">
              <span class="nav-what">Decisions outside the diff</span>
              <span class="count">{props.data.grouped!.outside.length}</span>
            </a>
          </li>
        </Show>
      </ol>
    </Arrives>
  );
}

const ROWS = [
  "The parts that read first",
  "What the change is for",
  "Where its code goes",
] as const;

/** The outline before the diff is read: its title and a few rows. */
Outline.Skeleton = function Skeleton() {
  return (
    <div class="sk" role="status" aria-busy="true" aria-label="Reading the review">
      <p class="nav-title">
        <Masked>Units</Masked>
      </p>
      <p class="nav-viewed">
        <Masked>0 of 10 files viewed</Masked>
      </p>
      <ol>
        <For each={ROWS}>
          {(row) => (
            <li>
              <a>
                <span class="nav-what">
                  <Masked>{row}</Masked>
                </span>
                <span class="count">
                  <Masked>2 changes</Masked>
                </span>
              </a>
            </li>
          )}
        </For>
      </ol>
    </div>
  );
};
