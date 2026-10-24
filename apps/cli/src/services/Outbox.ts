import { Clock, Context, Effect, Layer, Stream, SubscriptionRef } from "effect";
import { ticketName, type Outgoing, type Proposal } from "@collagen/p2p";
import { actingAgent } from "../lib/agents";
import { NO_TITLE } from "../lib/review";
import { Dispatch } from "./Dispatch";
import { StateStore } from "./StateStore";

export type { Proposal };

/** How many sent things to remember. Enough to answer "what did my agent
 *  just do", not a permanent archive — the room's log is that. */
const KEPT = 50;

/** A proposal in the pieces a row shows: what kind of thing it is, which
 *  project it belongs to, the person it is for (nobody, when it is for the
 *  room), and what it is about. Derived from the outgoing itself — `to` and
 *  `title` are for logs and headings, and "the room" is not a person. */
export interface OutgoingSummary {
  readonly kind: string;
  readonly project: string | null;
  readonly target: string | null;
  readonly subject: string;
}

export const outgoingSummary = (proposal: Proposal): OutgoingSummary => {
  const outgoing = proposal.outgoing;
  const person = (name: string) => (name.startsWith("the room") ? null : name);
  switch (outgoing.kind) {
    case "message":
      return { kind: "message", project: outgoing.project, target: outgoing.peer, subject: outgoing.intent };
    case "ticket":
      return { kind: outgoing.ticket.kind, project: outgoing.ticket.project, target: person(proposal.to), subject: ticketName(outgoing.ticket) };
    case "review":
      return outgoing.ticket
        ? { kind: "review", project: outgoing.ticket.project, target: person(proposal.to), subject: ticketName(outgoing.ticket) }
        : { kind: "review", project: null, target: person(proposal.to), subject: `more why · ${outgoing.review.summary}` };
    case "post-review":
      return { kind: "review", project: null, target: person(proposal.to), subject: "your review" };
    case "settle":
      return { kind: "settle", project: null, target: person(proposal.to), subject: outgoing.stepId };
    case "take":
      return { kind: "take", project: null, target: null, subject: proposal.title };
    case "close":
      return { kind: "close", project: null, target: null, subject: proposal.title };
    case "epic-move":
      return { kind: "epic", project: null, target: null, subject: outgoing.epic ? `${outgoing.ticketIds.length} ${outgoing.excluded === true ? "excluded in" : outgoing.excluded === false ? "counted again in" : "into"} "${outgoing.name ?? outgoing.goal}"` : `${outgoing.ticketIds.length} out of its epic` };
    case "epic-order":
      return { kind: "epic", project: null, target: null, subject: `order of "${outgoing.name ?? outgoing.goal}"` };
    case "epic-turn":
      return { kind: "epic", project: null, target: null, subject: proposal.title };
    case "attach":
      return { kind: "files", project: null, target: person(proposal.to), subject: `${outgoing.items.length} on "${outgoing.goal}"` };
    case "transcript":
      return { kind: "transcript", project: null, target: person(proposal.to), subject: outgoing.subject };
  }
};

/** The full text of a proposal, as the person reads it before saying yes. */
export function proposalText(proposal: Proposal): string {
  const outgoing = proposal.outgoing;
  switch (outgoing.kind) {
    case "message":
      return outgoing.findings;
    case "ticket":
      return outgoing.ticket.steps.map((step) => `${step.id} · ${step.intent}: ${step.description}`).join("\n");
    case "settle":
      return outgoing.result;
    case "take":
      return `step ${outgoing.stepId} taken: yours now`;
    case "post-review":
      return outgoing.findings;
    case "review": {
      const review = outgoing.review;
      const head = [
        review.branch ? (review.base ? `${review.branch} → ${review.base}` : review.branch) : "",
        review.link ?? "",
      ].filter((part) => part.length > 0);
      // your own words are in here: this is the text to read before it goes
      return [
        outgoing.ticket ? `a review of "${ticketName(outgoing.ticket)}"` : "more why for a review already on the ticket",
        ...(head.length > 0 ? [head.join(" · ")] : []),
        review.summary,
        "",
        "why it is the way it is — this goes on the room's log for everyone in it:",
        ...review.decisions.map((decision) => `- ${decision.id} ${decision.title ?? `(${NO_TITLE})`}\n    ${decision.what}${decision.userWhy ? `\n    you: ${decision.userWhy}` : ""}${decision.agentWhy ? `\n    agent: ${decision.agentWhy}` : ""}${decision.guidedBy && decision.guidedBy.length > 0 ? `\n    guided by: ${decision.guidedBy.join(", ")}` : ""}${decision.where.length > 0 ? `\n    ${decision.where.join(", ")}` : ""}`),
        ...(review.units && review.units.length > 0 ? ["", "units — how the code reads:", ...review.units.map((unit) => `- ${unit.id} ${unit.title}${unit.usesOf ? ` (uses of ${unit.usesOf})` : ""}${unit.what ? `\n    ${unit.what}` : ""}\n    ${unit.where.join(", ")}`)] : []),
        ...(review.forks.length > 0 ? ["", "forks in the road:"] : []),
        ...review.forks.map((fork) => `- ${fork.id} ${fork.at}: chose ${fork.chose} over ${fork.instead} — ${fork.why}${fork.by ? ` (${fork.by}'s call)` : ""}`),
      ].join("\n");
    }
    case "transcript":
      return `your ${outgoing.ai} conversation ${outgoing.sessionId.slice(0, 8)}… on thread ${outgoing.threadId}, from ${new Date(outgoing.since).toISOString()} on — every line of it, as the session file has it. It goes to the requester only.`;
    case "close":
      return `closed${outgoing.outcome === "dropped" ? " as dropped" : outgoing.outcome === "done" ? " as done" : ""}${outgoing.reason ? ` — ${outgoing.reason}` : ""}`;
    case "epic-move":
      return outgoing.epic
        ? `${outgoing.excluded === true ? "kept in the epic but out of its progress" : outgoing.excluded === false ? "counted in the epic's progress again" : "put into the epic"} "${outgoing.name ?? outgoing.goal}": ${outgoing.ticketIds.join(", ")}`
        : `taken out of their epic: ${outgoing.ticketIds.join(", ")}`;
    case "epic-order":
      return `"${outgoing.name ?? outgoing.goal}" read in this order: ${outgoing.ticketIds.join(", ")}`;
    case "epic-turn":
      return `${outgoing.closed ? "closed" : "reopened"}${outgoing.reason ? ` — ${outgoing.reason}` : ""}`;
    case "attach":
      return `${outgoing.items.length} file(s) attached to "${outgoing.goal}"${outgoing.note ? ` — ${outgoing.note}` : ""}. The references go on the ticket for everyone; the files go only to whoever fetches them while you are online:\n${outgoing.items
        .map((item) => `- ${item.name} · ${Math.max(1, Math.round(item.bytes / 1024))} kB${item.transcript ? ` · ${item.transcript.from}'s ${item.transcript.ai} conversation, ${item.transcript.entries} entries` : ` · ${item.mime}`}`)
        .join("\n")}`;
  }
}

/** The outbox: what has gone out of this machine, newest first.
 *
 *  It used to be an approval queue — the agent proposed, the person pressed y.
 *  That was theatre: an agent only ever acts on its person's request, so the
 *  person was approving what they had just asked for, and a thing that
 *  "exists but is not quite sent" is a state nobody wants to reason about.
 *  Now a tool writes to the room at once and lands here as a record. The
 *  person's control is where it belongs: the agent acts only when asked, and
 *  this list says plainly what it did.
 *
 *  Dispatch is still the single writer — everything that reaches a room's log
 *  on the agent's behalf goes through it, and through here. */
export class Outbox extends Context.Service<Outbox>()("cli/Outbox", {
  make: Effect.gen(function* () {
    const store = yield* StateStore;
    const dispatch = yield* Dispatch;

    const all = store.get.pipe(Effect.map((state) => state.sent ?? []));
    const changes = SubscriptionRef.changes(store.state).pipe(Stream.map((state) => state.sent ?? []));

    /** Do it, then remember it — and only if it was done. A refused write
     *  (not admitted yet, peer gone, the file unreadable) leaves no row: the
     *  outbox is a receipt of what left this machine, so a failure recorded
     *  as a send would be a lie the person cannot see through. The caller
     *  gets the outcome, tag and all: some of them have to retry. */
    const send = (proposal: Omit<Proposal, "id" | "ts" | "agent">) =>
      Effect.gen(function* () {
        // the agent whose tool call this is — none when the person acted
        const agent = yield* actingAgent;
        const outcome = yield* dispatch.perform(proposal.roomId, proposal.outgoing, agent);
        if (outcome._tag === "sent") {
          const full: Proposal = { ...proposal, id: crypto.randomUUID(), ts: yield* Clock.currentTimeMillis, ...(agent ? { agent } : {}) };
          yield* store.update((state) => ({ ...state, sent: [full, ...(state.sent ?? [])].slice(0, KEPT) }));
        }
        const mark = outcome._tag === "sent" ? "↗" : "✕";
        yield* Effect.log(`${mark} ${proposal.outgoing.kind} → ${proposal.to} · ${proposal.title} — ${outcome.text.split("\n")[0]}`);
        return outcome;
      });

    /** For a caller that only relays what happened to its agent: the text,
     *  without the tag. Anything that must react to a refusal (retry, keep a
     *  peer's request alive) uses `send` and reads the tag. */
    const tell = (proposal: Omit<Proposal, "id" | "ts" | "agent">) => send(proposal).pipe(Effect.map((outcome) => outcome.text));

    return { all, changes, send, tell } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
