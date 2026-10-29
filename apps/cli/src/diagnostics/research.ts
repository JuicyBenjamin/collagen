import { homedir } from "node:os";
import { Effect, Schema, SubscriptionRef } from "effect";
import { encode as toToon } from "@toon-format/toon";
import { visibleTo } from "@collagen/p2p";
import { JOB_LABEL } from "../lib/jobs";
import { sameName } from "../lib/names";
import { diagnostic } from "./registry";

/** Need more info: a research job on a ticket, run by the person's AI. */
export const research = diagnostic<{ readonly ticketId: string; readonly ask?: string }>({
  id: "research",
  title: "need more info",
  summary:
    "Start a research job on a ticket (a plan, a proposal or a bug) that needs more info: collagen runs your user's preferred AI, with the model they chose for research, in the background — it reads the ticket and the thinking behind it, looks into it (the project's code, read only, and the web) and posts what it found, and its questions for your user, as one take on the ticket. Jobs run one at a time unless your user allows more; the rest wait in line (jobs lists them). It runs their AI in their name, so it follows their steering for running their AI. 'ask' is what they want to know, in their words.",
  params: Schema.Struct({ ticketId: Schema.String, ask: Schema.optional(Schema.String) }),
  fromContext: (context) => (context.ticketId ? { ticketId: context.ticketId } : null),
  run: ({ ticketId, ask }, context, { rooms, jobs, state, me }) =>
    Effect.gen(function* () {
      const handle = (yield* SubscriptionRef.get(rooms.handles)).find((candidate) => candidate.id === context.roomId);
      if (!handle) return "failed: that room is gone";
      const all = yield* SubscriptionRef.get(handle.room.tickets);
      const ticket = all.get(ticketId);
      if (!ticket || !visibleTo(ticket, all, me)) return `failed: no ticket ${ticketId} — check get-tickets`;
      if (ticket.kind !== "plan" && ticket.kind !== "proposal" && ticket.kind !== "bug") return `failed: research is for a plan, a proposal or a bug; this is a ${ticket.kind}`;
      // it looks at the project's own code, where this machine has it
      const project = ((yield* state).rooms[context.roomId] ?? []).find((candidate) => sameName(candidate.name, ticket.project));
      return yield* jobs.research({ roomId: context.roomId, ticket, cwd: project?.path ?? homedir(), ...(ask ? { ask } : {}) });
    }),
});

/** What collagen is running for the person, and what waits. */
export const jobsList = diagnostic<Record<string, never>>({
  id: "jobs",
  title: "jobs",
  summary: "The jobs collagen runs your user's AI for (research on a ticket): what is running, what waits in line, and what finished lately — on which ticket, with which AI and model.",
  fromContext: () => null,
  run: (_params, _context, { jobs }) =>
    Effect.gen(function* () {
      const views = yield* SubscriptionRef.get(jobs.views);
      if (views.length === 0) return "no jobs: nothing is running or waiting";
      return toToon({
        jobs: views.map((view) => ({ state: view.state, job: JOB_LABEL[view.kind], ticket: `${view.title} [${view.ticketId}]`, ai: view.harness, model: view.model ?? "its default", note: view.note ?? "" })),
      });
    }),
});
