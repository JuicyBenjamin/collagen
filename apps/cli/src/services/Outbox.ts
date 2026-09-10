import { Clock, Context, Effect, Layer, Stream, SubscriptionRef } from "effect";
import type { Outgoing, Proposal } from "@collagen/p2p";
import { Dispatch } from "./Dispatch";
import { StateStore } from "./StateStore";

export type { Proposal };

/** The text a tool returns to the agent when its call was queued instead of run. */
export const QUEUED_TEXT =
  "queued for your user's approval — nothing leaves this machine until they approve it in the collagen TUI (outbox section). Tell them what you queued, then stop: do not resend, and do not work around it.";

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

/** Can the person change the text before it goes? (A ticket's shape is the
 *  agent's to redraft: reject it and say what you want instead; a transcript
 *  is the file as it is — hand it over or don't.) */
export const editable = (p: Proposal): boolean => p.outgoing.kind === "message" || p.outgoing.kind === "settle" || p.outgoing.kind === "post-review";

/** Human in the loop, sending side. send-to-peer, create-ticket and
 *  settle-step don't run when the agent calls them: they propose, the person
 *  approves (after editing, if they like) or rejects in the TUI, and only
 *  then does Dispatch write the log. Proposals are data in LocalState, so
 *  they wait across a restart. Mocked agents are dev dummies and skip the
 *  gate, as does COLLAGEN_AUTO_APPROVE=1 — for tests, never for people. */
export class Outbox extends Context.Service<Outbox>()("cli/Outbox", {
  make: Effect.gen(function* () {
    const store = yield* StateStore;
    const dispatch = yield* Dispatch;

    const envAuto = process.env.COLLAGEN_AUTO_APPROVE === "1";
    if (envAuto) yield* Effect.logWarning("COLLAGEN_AUTO_APPROVE=1: outgoing messages leave WITHOUT a person approving them (testing only)");

    /** Mocks are not people; nothing to approve. */
    const bypass = store.get.pipe(Effect.map((s) => envAuto || (s.preferredAi ?? "").startsWith("mock")));

    const all = store.get.pipe(Effect.map((s) => s.outbox ?? []));
    const changes = SubscriptionRef.changes(store.state).pipe(Stream.map((s) => s.outbox ?? []));
    const setAll = (f: (ps: ReadonlyArray<Proposal>) => ReadonlyArray<Proposal>) =>
      store.update((s) => ({ ...s, outbox: f(s.outbox ?? []) }));

    const describe = (p: Proposal) => `${p.outgoing.kind} → ${p.to} · ${p.title}`;

    const waiting = all.pipe(Effect.map((ps) => ps.length));
    if ((yield* waiting) > 0) yield* Effect.log(`⧗ outbox: ${yield* waiting} proposal(s) still waiting for your approval from before`);

    /** Queue it behind the person's approval; returns what the agent is told. */
    const propose = (p: Omit<Proposal, "id" | "ts">) =>
      Effect.gen(function* () {
        if (yield* bypass) {
          // no person to ask (a mock, or a test run): straight out — but say so
          const outcome = yield* dispatch.perform(p.roomId, p.outgoing);
          yield* Effect.log(
            `↗ sent without approval (${envAuto ? "COLLAGEN_AUTO_APPROVE" : "mock"}): ${p.outgoing.kind} → ${p.to} · ${p.title} — ${outcome.split("\n")[0]}`,
          );
          return outcome;
        }
        const full: Proposal = { ...p, id: crypto.randomUUID(), ts: yield* Clock.currentTimeMillis };
        yield* setAll((ps) => [...ps, full]);
        yield* Effect.log(`⧗ outbox: ${describe(full)} — awaiting your approval`);
        return QUEUED_TEXT;
      });

    const take = (id: string) =>
      Effect.gen(function* () {
        const found = (yield* all).find((p) => p.id === id) ?? null;
        if (found) yield* setAll((ps) => ps.filter((p) => p.id !== id));
        return found;
      });

    /** The person said yes: it leaves now. */
    const approve = (id: string) =>
      Effect.gen(function* () {
        const p = yield* take(id);
        if (!p) return "gone";
        const outcome = yield* dispatch.perform(p.roomId, p.outgoing);
        yield* Effect.log(`✓ approved: ${describe(p)} — ${outcome.split("\n")[0]}`);
        return outcome;
      });

    /** The person said no: it never happened. The agent is not told — the
     *  person tells it, in their own words. */
    const reject = (id: string) =>
      Effect.gen(function* () {
        const p = yield* take(id);
        if (p) yield* Effect.log(`✗ rejected: ${describe(p)}`);
      });

    /** The person changed the words before sending (message findings, or a
     *  step's result). What leaves is what they wrote. */
    const edit = (id: string, text: string) =>
      setAll((ps) =>
        ps.map((p) => {
          if (p.id !== id) return p;
          const o: Outgoing =
            p.outgoing.kind === "message" || p.outgoing.kind === "post-review"
              ? { ...p.outgoing, findings: text }
              : p.outgoing.kind === "settle"
                ? { ...p.outgoing, result: text }
                : p.outgoing;
          return { ...p, outgoing: o };
        }),
      );

    return { all, changes, propose, approve, reject, edit } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
