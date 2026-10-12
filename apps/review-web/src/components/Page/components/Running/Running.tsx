import { createSignal, For, Show } from "solid-js";
import type { ReviewPageHead, Show as ShowData } from "~/data";
import { Appear } from "~/components/Appear";
import { PageLink } from "./components/PageLink";
import { Request } from "./components/Request";

// Where the change can be seen running, as its author's agent knew it ran: a
// page to open, or a request to send again from the reader's own collagen —
// its body theirs to edit, signed in with their own token. The token goes to
// their instance and stays there; the page never sees it again.

/** The origin a reader's token is kept for — one per page, so every request there shows it. */
const originOf = (url: string): string => {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
};

/** Under the header: its pages and requests, when its author named any —
 *  with the head, so it stands from the first paint and nothing under it moves. */
export function Running(props: { head: ReviewPageHead }) {
  return (
    <Appear when={props.head.review.shows && props.head.review.shows.length > 0 ? props.head.review.shows : null}>
      {(shows) => <List shows={shows()} author={props.head.review.authorName} />}
    </Appear>
  );
}

function List(props: { shows: ReadonlyArray<ShowData>; author: string }) {
  // signed in or not, per origin: a token saved on one request holds for every one there
  const [signed, setSigned] = createSignal<Readonly<Record<string, boolean>>>(
    Object.fromEntries(props.shows.filter((show) => show.method).map((show) => [originOf(show.url), show.signedIn === true])),
  );
  const access = (show: ShowData) => ({
    now: () => signed()[originOf(show.url)] === true,
    set: (value: boolean) => setSigned((byOrigin) => ({ ...byOrigin, [originOf(show.url)]: value })),
  });
  return (
    <section class="running" aria-label="See it running">
      <p class="who">See it running</p>
      <ul>
        <For each={props.shows}>
          {(show) => (
            <li>
              <Show when={show.method} fallback={<PageLink show={show} author={props.author} />}>
                <Request show={show} author={props.author} signedIn={access(show)} />
              </Show>
            </li>
          )}
        </For>
      </ul>
    </section>
  );
}
