import { createEffect, createMemo, createSignal, Errored, Loading } from "solid-js";
import type { ReviewPageData, ReviewPageHead } from "./data";
import { Page } from "./components/Page";
import { Popover } from "./components/Popover";
import { reviewData, reviewHead } from "./api";
import { overSocket } from "./liveSocket";
import { hostNow } from "./hostNow";
import { kept } from "./kept";
import { lasting } from "./lasting";
import { ticketId } from "./ticket";

// The review page: a review ticket's diff read by purpose (components/Page).
// Here, only what it reads: the review's own part (title, why) from the
// room, its diff, and its state, live. Each part of the page waits on its
// own read and arrives as soon as that is in (components/Arrives).

async function loadHead(): Promise<ReviewPageHead> {
  const head = await reviewHead(ticketId);
  if (!head) throw new Error(`no review ticket ${ticketId} in your rooms`);
  return head;
}

async function load(): Promise<ReviewPageData> {
  const data = await reviewData(ticketId);
  if (!data) throw new Error(`no review ticket ${ticketId} in your rooms`);
  return data;
}

/** The header as it was last read, standing in while it is read again: a
 *  reload shows the page's top as it will be. Only a header of this ticket,
 *  of the shape the page reads. */
const header = kept(`collagen.head.v2.${ticketId}`, (value): value is ReviewPageHead => {
  const head = value as Partial<ReviewPageHead> | null;
  return (
    head?.ticket?.id === ticketId &&
    Array.isArray(head.review?.decisions) &&
    Array.isArray(head.review?.forks) &&
    Array.isArray(head.links)
  );
});
const keepHead = (head: ReviewPageHead) =>
  header.keep({ ticket: head.ticket, review: head.review, links: head.links });

export function App() {
  // the review's state, from a live server function held open while the
  // page is: a token that moves when its why is revised, the ticket moves,
  // or the branch's commit in the clone changes — opened again whenever the
  // connection breaks (collagen restarted), its first value catching up
  const state = createMemo(() => lasting(() => overSocket("changes", ticketId)));
  // the review on its host, read beside the data
  hostNow.start(state);
  // its data, read again whenever that state moves — what is on screen
  // stays until the new data is in. The head is read on its own only until
  // the diff is first in: after that it is the data's own, so the title and
  // the why above never show a later moment than the code beneath them
  let read = false;
  const data = createMemo(() => {
    state();
    return load().then((loaded) => {
      read = true;
      keepHead(loaded);
      return loaded;
    });
  });
  // the head read again whenever the review moves; the one kept from the
  // last visit stands in until the first of them is in
  const [freshHead, setFreshHead] = createSignal<ReviewPageHead | null>(null);
  let reading: Promise<ReviewPageHead> | null = null;
  const readHead = (): Promise<ReviewPageHead> =>
    (reading ??= loadHead().then((loaded) => {
      keepHead(loaded);
      setFreshHead(loaded);
      reading = null;
      return loaded;
    }));
  createEffect(
    () => state(),
    () => {
      void readHead();
    },
  );
  const head = createMemo((): ReviewPageHead | Promise<ReviewPageHead> =>
    read ? data() : (freshHead() ?? header.last ?? readHead()),
  );
  return (
    <Errored fallback={(error) => <p class="failed">{String(error())}</p>}>
      <Loading fallback={<Page.Skeleton />}>
        <Page head={head()} data={data()} />
        <Popover />
      </Loading>
    </Errored>
  );
}
