import { createSignal } from "solid-js";
import type { RunningJob } from "./data";
import { lasting } from "./lasting";
import { overSocket } from "./liveSocket";
import { ticketId } from "./ticket";

// What runs on this review right now: the reader's own jobs and those a
// peer shares while they run — live over the page's socket, so the header
// says it is being worked on, and how far, without the diff read again.

const [jobs, setJobs] = createSignal<ReadonlyArray<RunningJob>>([]);
let started = false;

export const runningNow = {
  /** the jobs running on this review, the longest running first */
  jobs,
  /** follow them, once per page */
  start: () => {
    if (started || !ticketId) return;
    started = true;
    void (async () => {
      for await (const now of lasting(() => overSocket("running", ticketId))) setJobs(now);
    })();
  },
};
