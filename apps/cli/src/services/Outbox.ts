import { Clock, Context, Effect, Layer, Stream, SubscriptionRef } from "effect";
import type { Outgoing, Proposal } from "@collagen/p2p";
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

export const outgoingSummary = (p: Proposal): OutgoingSummary => {
  const o = p.outgoing;
  const person = (name: string) => (name.startsWith("the room") ? null : name);
  switch (o.kind) {
    case "message":
      return { kind: "message", project: o.project, target: o.peer, subject: o.intent };
    case "ticket":
      return { kind: o.ticket.kind, project: o.ticket.project, target: person(p.to), subject: o.ticket.goal };
    case "review":
      return o.ticket
        ? { kind: "review", project: o.ticket.project, target: person(p.to), subject: o.ticket.goal }
        : { kind: "review", project: null, target: person(p.to), subject: `more why · ${o.review.summary}` };
    case "post-review":
      return { kind: "review", project: null, target: person(p.to), subject: "your review" };
    case "settle":
      return { kind: "settle", project: null, target: person(p.to), subject: o.stepId };
    case "attach":
      return { kind: "files", project: null, target: person(p.to), subject: `${o.items.length} on "${o.goal}"` };
    case "transcript":
      return { kind: "transcript", project: null, target: person(p.to), subject: o.subject };
  }
};

/** The full text of a proposal, as the person reads it before saying yes. */
export function proposalText(p: Proposal): string {
  const o = p.outgoing;
  switch (o.kind) {
    case "message":
      return o.findings;
    case "ticket":
      return o.ticket.steps.map((s) => `${s.id} · ${s.intent}: ${s.description}`).join("\n");
    case "settle":
      return o.result;
    case "post-review":
      return o.findings;
    case "review": {
      const r = o.review;
      const head = [
        r.branch ? (r.base ? `${r.branch} → ${r.base}` : r.branch) : "",
        r.link ?? "",
      ].filter((x) => x.length > 0);
      // your own words are in here: this is the text to read before it goes
      return [
        o.ticket ? `a review of "${o.ticket.goal}"` : "more why for a review already on the ticket",
        ...(head.length > 0 ? [head.join(" · ")] : []),
        r.summary,
        "",
        "why it is the way it is — this goes on the room's log for everyone in it:",
        ...r.decisions.map((d) => `- ${d.id} ${d.what}${d.userWhy ? `\n    you: ${d.userWhy}` : ""}${d.agentWhy ? `\n    agent: ${d.agentWhy}` : ""}${d.where.length > 0 ? `\n    ${d.where.join(", ")}` : ""}`),
        ...(r.forks.length > 0 ? ["", "forks in the road:"] : []),
        ...r.forks.map((f) => `- ${f.id} ${f.at}: chose ${f.chose} over ${f.instead} — ${f.why}${f.by ? ` (${f.by}'s call)` : ""}`),
      ].join("\n");
    }
    case "transcript":
      return `your ${o.ai} conversation ${o.sessionId.slice(0, 8)}… on thread ${o.threadId}, from ${new Date(o.since).toISOString()} on — every line of it, as the session file has it. It goes to the requester only.`;
    case "attach":
      return `${o.items.length} file(s) attached to "${o.goal}"${o.note ? ` — ${o.note}` : ""}. The references go on the ticket for everyone; the files go only to whoever fetches them while you are online:\n${o.items
        .map((i) => `- ${i.name} · ${Math.max(1, Math.round(i.bytes / 1024))} kB${i.transcript ? ` · ${i.transcript.from}'s ${i.transcript.ai} conversation, ${i.transcript.entries} entries` : ` · ${i.mime}`}`)
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

    const all = store.get.pipe(Effect.map((s) => s.sent ?? []));
    const changes = SubscriptionRef.changes(store.state).pipe(Stream.map((s) => s.sent ?? []));

    /** Do it, then remember it — and only if it was done. A refused write
     *  (not admitted yet, peer gone, the file unreadable) leaves no row: the
     *  outbox is a receipt of what left this machine, so a failure recorded
     *  as a send would be a lie the person cannot see through. The caller
     *  gets the outcome, tag and all: some of them have to retry. */
    const send = (p: Omit<Proposal, "id" | "ts">) =>
      Effect.gen(function* () {
        const outcome = yield* dispatch.perform(p.roomId, p.outgoing);
        if (outcome._tag === "sent") {
          const full: Proposal = { ...p, id: crypto.randomUUID(), ts: yield* Clock.currentTimeMillis };
          yield* store.update((s) => ({ ...s, sent: [full, ...(s.sent ?? [])].slice(0, KEPT) }));
        }
        const mark = outcome._tag === "sent" ? "↗" : "✕";
        yield* Effect.log(`${mark} ${p.outgoing.kind} → ${p.to} · ${p.title} — ${outcome.text.split("\n")[0]}`);
        return outcome;
      });

    /** For a caller that only relays what happened to its agent: the text,
     *  without the tag. Anything that must react to a refusal (retry, keep a
     *  peer's request alive) uses `send` and reads the tag. */
    const tell = (p: Omit<Proposal, "id" | "ts">) => send(p).pipe(Effect.map((d) => d.text));

    return { all, changes, send, tell } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
