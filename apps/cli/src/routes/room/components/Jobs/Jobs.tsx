import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { theme } from "../../../../app/theme";
import { JOB_LABEL } from "../../../../lib/jobs";
import type { JobView } from "../../../../services/Jobs";
import { jobsAtom } from "../../atoms";

const MARK: Record<JobView["state"], string> = { queued: "…", running: "▸", done: "✓", failed: "✕" };

/** What collagen is running the person's AI for, and what waits: one line
 *  each — its state, the job, the ticket, the AI and model. Shown only when
 *  there is something to show. */
export function Jobs() {
  const jobs = AsyncResult.getOrElse(useAtomValue(jobsAtom), (): ReadonlyArray<JobView> => []);
  if (jobs.length === 0) return null;
  return (
    <box flexDirection="column" flexShrink={0} marginBottom={1}>
      <text fg={theme.dim}>jobs — what collagen runs your AI for</text>
      {jobs.map((job) => (
        <text key={job.id} truncate wrapMode="none" fg={job.state === "running" ? theme.accent : job.state === "failed" ? theme.warn : theme.fg}>
          {`${MARK[job.state]} ${JOB_LABEL[job.kind]} · ${job.title} · ${job.harness}${job.model ? ` (${job.model})` : ""}${job.state === "failed" && job.note ? ` — ${job.note}` : ""}`}
        </text>
      ))}
    </box>
  );
}

/** For the status line: how many run and wait, or nothing. */
export const jobsLine = (jobs: ReadonlyArray<JobView>): string | null => {
  const running = jobs.filter((job) => job.state === "running").length;
  const queued = jobs.filter((job) => job.state === "queued").length;
  if (running + queued === 0) return null;
  return `jobs ${running} running${queued > 0 ? ` · ${queued} waiting` : ""}`;
};
