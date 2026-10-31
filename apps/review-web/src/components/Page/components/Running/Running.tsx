import { For } from "solid-js";
import type { ReviewPageHead, Show as ShowData } from "~/data";
import { Appear } from "~/components/Appear";
import { PageLink } from "./components/PageLink";

// Where the change can be seen running, as its author's agent knew it ran:
// pages to open, each saying where it runs.

/** Under the header: its pages, when its author named any — with the head,
 *  so it stands from the first paint and nothing under it moves. */
export function Running(props: { head: ReviewPageHead }) {
  return (
    <Appear when={props.head.review.shows && props.head.review.shows.length > 0 ? props.head.review.shows : null}>
      {(shows) => <List shows={shows()} />}
    </Appear>
  );
}

function List(props: { shows: ReadonlyArray<ShowData> }) {
  return (
    <section class="running" aria-label="See it running">
      <p class="who">See it running</p>
      <ul>
        <For each={props.shows}>
          {(show) => (
            <li>
              <PageLink show={show} />
            </li>
          )}
        </For>
      </ul>
    </section>
  );
}
