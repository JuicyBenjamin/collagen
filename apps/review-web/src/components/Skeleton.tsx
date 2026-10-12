import { For } from "solid-js";

// The review page's shape, before there is anything to put in it: bars where
// the title, the outline and the code will be, laid out as the real parts
// are. They give way to the parts as each is read (App.tsx).

const bar = (width: string, tall = false) => <span class={["sk-bar", { tall }]} style={{ width }} />;

/** The outline's rows. */
export function NavSkeleton() {
  return (
    <div class="sk" role="status" aria-busy="true" aria-label="Reading the review">
      <p class="nav-title">{bar("48px")}</p>
      <ol>
        <For each={["80%", "64%", "72%", "56%"]}>
          {(width) => (
            <li>
              <span class="sk-row">
                {bar(width)}
                {bar("40%")}
              </span>
            </li>
          )}
        </For>
      </ol>
    </div>
  );
}

/** The title block: where it is on, the purpose, the line beneath. */
export function HeaderSkeleton() {
  return (
    <header class="sk" aria-hidden="true">
      <p class="meta">{bar("240px")}</p>
      <h1 class="purpose">{bar("min(420px, 70%)", true)}</h1>
      <p class="summary">{bar("min(560px, 90%)")}</p>
    </header>
  );
}

/** Units not read yet: each a title and a line, then a file's card of code lines. */
export function UnitsSkeleton(props: { count: number }) {
  return (
    <div class="sk" role="status" aria-busy="true" aria-label="Reading the code">
      <For each={Array.from({ length: props.count }, (_, index) => index)}>
        {(index) => (
          <section class="decision unit">
            <div class="decision-head">
              <h2>{bar(index % 2 ? "34%" : "42%", true)}</h2>
              <p class="decision-what">{bar("58%")}</p>
            </div>
            <div class="hunk-group sk-card">
              <div class="sk-card-head">{bar("30%")}</div>
              <For each={["92%", "78%", "86%", "54%", "70%"]}>{(width) => <div class="sk-line">{bar(width)}</div>}</For>
            </div>
          </section>
        )}
      </For>
    </div>
  );
}
