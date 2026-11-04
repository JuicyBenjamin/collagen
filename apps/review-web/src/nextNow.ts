import { createSignal } from "solid-js";
import type { TicketNext } from "./data";
import { lasting } from "./lasting";
import { overSocket } from "./liveSocket";
import { ticketId } from "./ticket";

// What this review waits on now: the jobs running on it (the reader's own,
// and those a peer shares while they run) and who it waits on next, and for
// what — live over the page's socket, so the header says it without the
// diff read again.

const [state, setState] = createSignal<TicketNext>({ running: [], next: null });
let started = false;

export const nextNow = {
  /** what it waits on now */
  state,
  /** follow it, once per page */
  start: () => {
    if (started || !ticketId) return;
    started = true;
    void (async () => {
      for await (const now of lasting(() => overSocket("next", ticketId))) setState(now);
    })();
  },
};
