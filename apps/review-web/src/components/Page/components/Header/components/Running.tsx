import { For } from "solid-js";
import type { RunningJob } from "~/data";
import { Appear } from "~/components/Appear";
import { runningNow } from "~/runningNow";

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

/** The jobs running on this review right now, each on a line: whose, what
 *  it is doing and how far it says it is. Gone when none runs. */
export function Running() {
  runningNow.start();
  return (
    <Appear when={runningNow.jobs().length > 0}>
      {() => (
        <div class="running-bar" role="status">
          <For each={runningNow.jobs()}>
            {(job) => (
              <div class="alert alert-soft alert-info">
                <span class="loading loading-spinner loading-sm" aria-hidden="true" />
                <span>{lineOf(job)}</span>
              </div>
            )}
          </For>
        </div>
      )}
    </Appear>
  );
}
