import { readFileSync } from "node:fs";
import { Clock, Context, Effect, Layer, SubscriptionRef } from "effect";
import { encode as toToon } from "@toon-format/toon";
import { closeTicket, epicOf, epicParts, excludedFromEpic, finished, isClosed, isJudged, isTake, moveToEpic, orderEpic, postReview, settleStep, ticketName, turnEpic, visibleTo, type Outgoing, type Ticket } from "@collagen/p2p";
import { relatedHint } from "../lib/epicHint";
import { personNamed } from "../lib/names";
import { ticketView } from "../lib/ticketView";
import { MAX_PACKED_BYTES, pack, sessionDirs, sessionFile, sliceSince } from "../lib/transcripts";
import { IdentityService } from "./Identity";
import { Rooms } from "./Rooms";
import { StateStore } from "./StateStore";

/** What a write did — and it is a type, not a string beginning with
 *  "failed:", because the outbox has to KNOW: it records what actually left
 *  this machine, and a caller that must retry (a transcript a peer is still
 *  waiting for) has to be able to tell. */
export type Done = { readonly _tag: "sent"; readonly text: string } | { readonly _tag: "refused"; readonly text: string };

/** It reached the room's log, or the peer. */
export const sent = (text: string): Done => ({ _tag: "sent", text });
/** Nothing left this machine, and the text says why. */
export const refused = (text: string): Done => ({ _tag: "refused", text });

const NOT_ADMITTED = refused("failed: you are not admitted to this room's log yet — a member has to be online once to admit you");

/** Writes an Outgoing to its room's log. The only place the cli
 *  appends messages, tickets or settlements on the agent's behalf — and it is
 *  reached from the Outbox alone, after the person's yes (or a mock's). Names
 *  are resolved here, at send time, so a proposal that waited across a
 *  restart still finds its peer. */
export class Dispatch extends Context.Service<Dispatch>()("cli/Dispatch", {
  make: Effect.gen(function* () {
    const rooms = yield* Rooms;
    const store = yield* StateStore;
    const { identity, nameRef } = yield* IdentityService;

    const perform = Effect.fn("Dispatch.perform")(function* (roomId: string, out: Outgoing) {
      const h = (yield* SubscriptionRef.get(rooms.handles)).find((x) => x.id === roomId);
      if (!h) return refused("failed: that room is gone");
      const { room } = h;
      const peers = yield* SubscriptionRef.get(room.roster);
      const members = yield* SubscriptionRef.get(room.members);
      const myName = yield* SubscriptionRef.get(nameRef);
      const nameFor = (key: string) =>
        key === identity.pubkey
          ? myName
          : (peers.find((p) => p.key === key)?.name ?? members.find((m) => m.key === key)?.name ?? key.slice(0, 12));
      const render = (t: Ticket) => toToon({ ticket: ticketView(t, nameFor) });

      switch (out.kind) {
        case "message": {
          // present peers first; then anyone the log remembers (they read it when back)
          const who = personNamed(out.peer, { peers, members, me: identity.pubkey });
          if (who._tag === "refused") return refused(who.text);
          const target = who.person;
          const online = peers.some((p) => p.key === target.key);
          return yield* room.sendTo(target.key, { project: out.project, intent: out.intent, findings: out.findings, ...(out.ticketId ? { ticketId: out.ticketId } : {}) }).pipe(
            Effect.map(() => sent(online ? `sent to ${target.name}` : `sent to ${target.name} (offline — they get it when they are next online)`)),
            Effect.catchTag("NotWritable", () => Effect.succeed(NOT_ADMITTED)),
          );
        }
        case "ticket": {
          const merged = yield* room.shareTicket(out.ticket).pipe(Effect.catchTag("NotWritable", () => Effect.succeed(null)));
          return merged ? sent(`${render(merged)}${relatedHint(merged, yield* SubscriptionRef.get(room.tickets), identity.pubkey)}`) : NOT_ADMITTED;
        }
        case "review": {
          // the record and the why, one write: the ticket first (so the
          // review it belongs to exists for everyone), then the context. A
          // ticket that is already on the log is being revised, not filed.
          const known = (yield* SubscriptionRef.get(room.tickets)).has(out.review.ticketId);
          if (out.ticket) {
            const shared = yield* room.shareTicket(out.ticket).pipe(Effect.catchTag("NotWritable", () => Effect.succeed(null)));
            if (!shared) return NOT_ADMITTED;
          }
          const ok = yield* room.shareReview(out.review).pipe(
            Effect.as(true),
            Effect.catchTag("NotWritable", () => Effect.succeed(false)),
          );
          if (!ok) return NOT_ADMITTED;
          const { decisions, forks } = out.review;
          // a description is read once; an outcome is read on the turn that
          // follows the write, which is where the next change starts. So both
          // instructions are said here, every time: what to tell the person,
          // and to come back when the code moves.
          // the same record serves a review, a plan and a proposal; the words
          // an agent reads back follow the kind
          const kind = out.ticket?.kind ?? (yield* SubscriptionRef.get(room.tickets)).get(out.review.ticketId)?.kind ?? "review";
          // an epic is a folder: filed, or its aim revised — no readers, no takes
          if (kind === "epic") {
            const filed = out.ticket ?? (yield* SubscriptionRef.get(room.tickets)).get(out.review.ticketId);
            const name = filed ? ticketName(filed) : "";
            return sent(
              out.ticket && !known
                ? `epic filed: "${name}" [ticket ${out.review.ticketId}]. Anyone in the room can now put tickets into it (epic, action add, with ticketIds). TELL YOUR USER ONLY THIS: "epic filed".`
                : `epic "${name}" [ticket ${out.review.ticketId}] updated. TELL YOUR USER ONLY THIS: "epic updated".`,
            );
          }
          const tool = kind === "review" ? "ask-review" : kind === "plan" ? "ask-plan" : kind === "bug" ? "report-bug" : "propose";
          const say = (what: string) =>
            `TELL YOUR USER ONLY THIS: "${kind} ticket has been ${what}". They asked for it, so the fact that it is done is the whole report — do not read the summary, the decisions, the forks or the counts back to them, and do not list what you wrote. It is on the ticket for whoever reads it, and their TUI shows the ticket.`;
          const keepCurrent = `Next time this changes — ${kind === "review" ? "a fix, a fork taken differently" : "your user rethinks a part of it, a reader's take changes their mind"}, anything your user asks for — call ${tool} again with ticketId "${out.review.ticketId}" and say what changed and why, in their words: re-send the summary if it no longer holds, and repeat the id of any decision or fork that has changed. What the room reads has to be what your user means.`;
          const held = `(${decisions.length} decision(s), ${forks.length} fork(s) now on it — for your own bookkeeping, not for your user)`;
          if (!out.ticket || known) return sent(`${kind} ticket updated [ticket ${out.review.ticketId}] ${held}. ${say("updated")} ${keepCurrent}`);
          // asked of others — a reading step of the filer's own (an assumed review) is not asking anyone
          const readers = out.ticket.steps.filter((s) => isTake(s) && s.owner !== identity.pubkey);
          const who =
            readers.length === 0
              ? "in the room, nobody asked in particular"
              : `asked of ${readers.map((s) => nameFor(s.owner)).join(", ")}`;
          // filed in order behind another: said to the agent, so nobody is
          // surprised that the readers have not seen it yet
          const waits =
            out.ticket.after && out.ticket.after.length > 0
              ? ` It waits on ${out.ticket.after.length} ticket(s) (after: ${out.ticket.after.join(", ")}): until they are answered nobody but your user is shown it or nudged about it; it opens to its readers by itself then.`
              : "";
          const related = relatedHint(out.ticket, yield* SubscriptionRef.get(room.tickets), identity.pubkey);
          return sent(`${kind} ticket filed, ${who}: "${ticketName(out.ticket)}" [ticket ${out.ticket.id}] ${held}.${waits} ${say("filed")} ${keepCurrent}${related}`);
        }
        case "settle": {
          const ticket = (yield* SubscriptionRef.get(room.tickets)).get(out.ticketId);
          if (!ticket) return refused(`failed: no ticket ${out.ticketId} — check get-tickets`);
          const step = ticket.steps.find((s) => s.id === out.stepId);
          if (!step) return refused(`failed: no step ${out.stepId} on ticket ${out.ticketId}`);
          const now = yield* Clock.currentTimeMillis;
          // one rule, shared with the drive path (see p2p settleStep)
          const done = settleStep(ticket, out.stepId, identity.pubkey, out.result, out.failed, now);
          if (!done || done.outcome === "not-yours") {
            return refused(`failed: step ${out.stepId} is ${nameFor(step.owner)}'s to settle${isJudged(ticket.kind) ? " — put your user's own take on the ticket with post-review" : " — say what your user thinks with send-to-peer (pass ticketId)"}`);
          }
          const merged = yield* room.shareTicket(done.ticket).pipe(Effect.catchTag("NotWritable", () => Effect.succeed(null)));
          if (!merged) return NOT_ADMITTED;
          // completion is a signal, closure is a decision: when this settle
          // answered the last step of the author's own ticket, the author's
          // agent is told where the decision now lies — and only told
          // a proposal that is accepted has decided nothing about who does what:
          // the plan that grows out of it is where ownership becomes binding
          const next =
            merged.kind === "proposal"
              ? ` If the idea is accepted, the obvious next step is a plan: ask-plan with from ["${merged.id}"] — the outline and any suggested owners on review-context are prefills, and your user confirms that plan; accepting assigns nothing.`
              : merged.kind === "bug"
                ? ` If it is to be fixed, what comes next names this bug in from: a plan (ask-plan) when the fix needs deciding, or the fix's review (ask-review) when it is done — the reviewers then read the symptom, cause and suggestion beside the why. Judging the bug assigns nothing.`
                : "";
          const offer =
            merged.createdBy === identity.pubkey && !isClosed(merged) && finished(merged)
              ? `\nEvery step on this ticket is answered.${next} When your user says they are done with it — and only then — call close-ticket with ticketId "${merged.id}"; it leaves the lists and stays on the log.`
              : "";
          return sent(render(merged) + offer);
        }
        case "epic-move": {
          const all = yield* SubscriptionRef.get(room.tickets);
          const target = out.epic === null ? null : all.get(out.epic);
          if (out.epic !== null && (!target || target.kind !== "epic")) return refused(`failed: no epic ${out.epic} — check get-tickets (kind: epic)`);
          if (target && isClosed(target, all)) return refused(`failed: "${ticketName(target)}" is closed — reopen it first (epic, action reopen, with why), then add to it`);
          const excluding = out.excluded;
          const now = yield* Clock.currentTimeMillis;
          const moved: Array<string> = [];
          const skipped: Array<string> = [];
          for (const [i, id] of out.ticketIds.entries()) {
            const t = all.get(id);
            if (!t || !visibleTo(t, all, identity.pubkey)) {
              skipped.push(`${id} (no such ticket)`);
              continue;
            }
            if (t.kind === "epic") {
              skipped.push(`"${ticketName(t)}" (an epic is never part of another)`);
              continue;
            }
            if (excluding !== undefined && epicOf(t) !== out.epic) {
              skipped.push(`"${ticketName(t)}" (not in that epic)`);
              continue;
            }
            const already = excluding !== undefined ? excludedFromEpic(t) === excluding : epicOf(t) === out.epic && (t.partOf?.length ?? 0) > 0;
            if (already) {
              skipped.push(`"${ticketName(t)}" (already ${excluding === true ? "excluded" : excluding === false ? "counted" : out.epic ? "in it" : "in none"})`);
              continue;
            }
            // one millisecond apart, so moves made together keep their order
            const merged = yield* room.shareTicket(moveToEpic(t, out.epic, identity.pubkey, now + i, excluding === true)).pipe(Effect.catchTag("NotWritable", () => Effect.succeed(null)));
            if (!merged) return NOT_ADMITTED;
            moved.push(`"${ticketName(t)}"`);
          }
          if (moved.length === 0) return refused(`failed: nothing moved — ${skipped.join("; ")}`);
          const progress = target ? epicParts(target, yield* SubscriptionRef.get(room.tickets)) : null;
          const what = excluding === true ? `kept in "${ticketName(target!)}" but out of its progress` : excluding === false ? `counted in "${ticketName(target!)}" again` : target ? `put into the epic "${ticketName(target)}"` : "taken out of their epic";
          return sent(
            `${what}: ${moved.join(", ")}${skipped.length > 0 ? ` — not moved: ${skipped.join("; ")}` : ""}.${progress ? ` It now holds ${progress.parts.length} ticket(s), ${progress.done} of ${progress.counted} done.` : ""} Anyone in the room sees it at once. TELL YOUR USER ONLY THIS: "${excluding === true ? "excluded from the epic's progress" : excluding === false ? "counted in the epic again" : target ? "added to the epic" : "taken out of the epic"}".`,
          );
        }
        case "epic-order": {
          const all = yield* SubscriptionRef.get(room.tickets);
          const epic = all.get(out.epicId);
          if (!epic || epic.kind !== "epic") return refused(`failed: no epic ${out.epicId} — check get-tickets (kind: epic)`);
          const inIt = new Set(epicParts(epic, all).parts.map((t) => t.id));
          const strangers = out.ticketIds.filter((id) => !inIt.has(id));
          if (strangers.length > 0) return refused(`failed: not in "${ticketName(epic)}": ${strangers.join(", ")} — order only what is in it (add them first)`);
          const now = yield* Clock.currentTimeMillis;
          const merged = yield* room.shareTicket(orderEpic(epic, out.ticketIds, identity.pubkey, now)).pipe(Effect.catchTag("NotWritable", () => Effect.succeed(null)));
          if (!merged) return NOT_ADMITTED;
          return sent(`"${ticketName(epic)}" is now read in this order: ${out.ticketIds.map((id) => `"${ticketName(all.get(id) ?? { goal: id })}"`).join(", ")} — the rest after them. Ordering hides nothing and sets no after. TELL YOUR USER ONLY THIS: "epic reordered".`);
        }
        case "epic-turn": {
          const all = yield* SubscriptionRef.get(room.tickets);
          const epic = all.get(out.epicId);
          if (!epic || epic.kind !== "epic") return refused(`failed: no epic ${out.epicId} — check get-tickets (kind: epic)`);
          const now = yield* Clock.currentTimeMillis;
          const turned = turnEpic(epic, out.closed, out.reason, identity.pubkey, all, now);
          if (turned.outcome === "already") return refused(`failed: "${ticketName(epic)}" is already ${out.closed ? "closed" : "open"}`);
          if (turned.outcome === "unresolved") {
            return refused(
              `failed: "${ticketName(epic)}" still holds ${turned.unresolved.length} unresolved ticket(s): ${turned.unresolved.map((t) => `"${ticketName(t)}" [${t.id}]`).join(", ")}. An epic closes only once everything in it is done, closed, or excluded — ask your user whether to resolve them, exclude them from its progress (epic, action exclude) or move them out (action remove).`,
            );
          }
          if (turned.outcome === "needs-reason") return refused(`failed: reopening "${ticketName(epic)}" needs a reason from your user — what more there is to do in it`);
          if (turned.outcome !== "turned") return refused(`failed: "${ticketName(epic)}" is not an epic`);
          const merged = yield* room.shareTicket(turned.ticket).pipe(Effect.catchTag("NotWritable", () => Effect.succeed(null)));
          if (!merged) return NOT_ADMITTED;
          const why = turned.ticket.turns?.at(-1)?.reason ?? "";
          return sent(`${out.closed ? "closed" : "reopened"} the epic "${ticketName(epic)}" [ticket ${epic.id}] — ${why}. ${out.closed ? "Its tickets are drawn in their projects again; anyone can reopen it, with a reason." : "It is back on the overview with its tickets."} TELL YOUR USER ONLY THIS: "epic ${out.closed ? "closed" : "reopened"}".`);
        }
        case "close": {
          const ticket = (yield* SubscriptionRef.get(room.tickets)).get(out.ticketId);
          if (!ticket) return refused(`failed: no ticket ${out.ticketId} — check get-tickets`);
          const now = yield* Clock.currentTimeMillis;
          const done = closeTicket(ticket, identity.pubkey, out.reason, now, out.outcome);
          if (done.outcome === "epic") return refused(`failed: "${ticketName(ticket)}" is an epic — it closes (and reopens) with the epic tool, by anyone, with a reason`);
          if (done.outcome === "not-yours") return refused(`failed: "${ticket.goal}" is ${nameFor(ticket.createdBy)}'s ticket to close — say what your user thinks with send-to-peer (pass ticketId)`);
          if (done.outcome === "already") return refused(`failed: "${ticket.goal}" was already closed by ${nameFor(ticket.closed!.by)}`);
          const merged = yield* room.shareTicket(done.ticket).pipe(Effect.catchTag("NotWritable", () => Effect.succeed(null)));
          if (!merged) return NOT_ADMITTED;
          const open = merged.steps.filter((s) => s.status === "pending" || s.status === "suspended").length;
          // the author's own instruction for this moment, written when the
          // ticket was filed — handed over now, and not a settle earlier. One
          // instruction to the agent, not two: what to report, then what to do
          const fact = `closed "${merged.goal}" [ticket ${merged.id}] as ${out.outcome === "dropped" ? "dropped (out of its epic's progress)" : "done"}${out.reason ? ` — ${out.reason.replace(/\.$/, "")}` : ""}. It has left the lists and stays on the log with its steps as they were${open > 0 ? ` (${open} never answered)` : ""}; later tickets can still refer to it.`;
          const then = merged.whenClosed
            ? `TELL YOUR USER that the ticket is closed, THEN carry out what it says to do when closed — "${merged.whenClosed}" — which they authorised when they filed it, and tell them what came of that.`
            : `TELL YOUR USER ONLY THIS: "ticket closed".`;
          return sent(`${fact} ${then}`);
        }
        case "post-review": {
          const ticket = (yield* SubscriptionRef.get(room.tickets)).get(out.ticketId);
          if (!ticket) return refused(`failed: no ticket ${out.ticketId} — check get-tickets`);
          const now = yield* Clock.currentTimeMillis;
          // a review lands on a step of its reader's own: nobody's is taken,
          // and posting again revises theirs
          const { ticket: updated, stepId } = postReview(ticket, { key: identity.pubkey, name: myName }, out.findings, out.failed, now);
          const merged = yield* room.shareTicket(updated).pipe(Effect.catchTag("NotWritable", () => Effect.succeed(null)));
          if (!merged) return NOT_ADMITTED;
          const others = merged.steps.filter((s) => isTake(s) && s.owner !== identity.pubkey).length;
          const word = ticket.kind === "review" ? "review" : "take";
          return sent(`your ${word} is on "${ticket.goal}" as step ${stepId}${others > 0 ? ` (beside ${others} other reader(s))` : ""} — anyone else in the room can still post theirs\n${render(merged)}`);
        }
        case "attach": {
          // references go on the log; the files stay here, remembered by
          // attachment id so a fetch can be answered — even after a restart
          const now = yield* Clock.currentTimeMillis;
          const files: Record<string, string> = {};
          let attached = 0;
          for (const item of out.items) {
            const id = crypto.randomUUID();
            const attachment = {
              id,
              ticketId: out.ticketId,
              holder: identity.pubkey,
              holderName: myName,
              name: item.name,
              bytes: item.bytes,
              mime: item.mime,
              ...(out.note ? { note: out.note } : {}),
              ...(item.transcript ? { transcript: item.transcript } : {}),
              attachedAt: now,
            };
            const ok = yield* room.attach(attachment).pipe(
              Effect.as(true),
              Effect.catchTag("NotWritable", () => Effect.succeed(false)),
            );
            if (ok) {
              files[id] = item.file;
              attached++;
            }
          }
          if (attached === 0) return NOT_ADMITTED;
          yield* store.update((st) => ({ ...st, attachedFiles: { ...(st.attachedFiles ?? {}), ...files } }));
          return sent(`attached ${attached} file(s) to "${out.goal}" — the references are on the ticket for everyone; the files go to whoever fetches them while you are online`);
        }
        case "transcript": {
          // read now, not when proposed: the file may have grown since
          const file = sessionFile(out.ai, out.sessionId, sessionDirs());
          if (!file) return refused(`failed: no ${out.ai} session file for ${out.sessionId.slice(0, 8)}… on this machine`);
          const text = yield* Effect.sync(() => {
            try {
              return readFileSync(file, "utf8");
            } catch {
              return null;
            }
          });
          if (text === null) return refused(`failed: could not read ${file}`);
          const { lines, entries } = sliceSince(text, out.since);
          const data = pack(lines);
          if (data.length > MAX_PACKED_BYTES) return refused(`failed: transcript too large to send (${Math.round(data.length / 1024 / 1024)} MB packed)`);
          return yield* room
            .sendTranscript(out.requester, {
              requestId: out.requestId,
              subject: out.subject,
              threadId: out.threadId,
              ai: out.ai,
              sessionId: out.sessionId,
              since: out.since,
              entries,
              data,
            })
            .pipe(
              Effect.map(() => sent(`transcript sent: ${entries} entries to ${nameFor(out.requester)}`)),
              Effect.catchTag("PeerNotConnected", () => Effect.succeed(refused(`failed: ${nameFor(out.requester)} is not connected right now — ask your user again when they are`))),
            );
        }
      }
    });

    return { perform } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
