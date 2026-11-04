import { For, Show } from "solid-js";
import type { RunningJob } from "~/data";
import { Appear } from "~/components/Appear";
import { nextNow } from "~/nextNow";

/** What a job of each kind is doing, as the reader reads it. */
const KIND_WORDS: Record<string, string> = {
  research: "researching it",
  investigation: "investigating it",
  filing: "filing the review",
  answering: "answering a question",
  guidance: "checking it against the notes",
};

const lineOf = (job: RunningJob): string =>
  `${job.who === "you" ? "Your AI" : `${job.who}'s AI`} is ${KIND_WORDS[job.kind] ?? "working on it"}${job.step !== undefined && job.of !== undefined ? ` — step ${job.step} of ${job.of}` : ""}${job.doing ? `: ${job.doing}` : ""}`;

/** What this review waits on now: each job running on it, whose and how far
 *  it says it is; and, when none runs, who it waits on next and for what —
 *  by hand, when it waits on a person rather than a step. */
export function Next() {
  nextNow.start();
  const running = () => nextNow.state().running;
  const next = () => nextNow.state().next;
  return (
    <Appear when={running().length > 0 || next() !== null}>
      {() => (
        <div class="next-bar" role="status">
          <For each={running()}>
            {(job) => (
              <div class="alert alert-soft alert-info">
                <span class="loading loading-spinner loading-sm" aria-hidden="true" />
                <span>{lineOf(job)}</span>
              </div>
            )}
          </For>
          <Show when={running().length === 0 ? next() : null}>
            {(waits) => (
              <div class={["alert alert-soft", waits().manual ? "alert-warning" : ""]}>
                <span>
                  Awaiting <strong>{waits().who}</strong>: {waits().what}
                </span>
              </div>
            )}
          </Show>
        </div>
      )}
    </Appear>
  );
}
