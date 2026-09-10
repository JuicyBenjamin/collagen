import { readFileSync } from "node:fs";
import { Clock, Context, Effect, Layer, SubscriptionRef } from "effect";
import { encode as toToon } from "@toon-format/toon";
import { postReview, settleStep, type Outgoing, type Ticket } from "@collagen/p2p";
import { ticketView } from "../lib/ticketView";
import { MAX_PACKED_BYTES, pack, sessionDirs, sessionFile, sliceSince } from "../lib/transcripts";
import { IdentityService } from "./Identity";
import { Rooms } from "./Rooms";
import { StateStore } from "./StateStore";

const NOT_ADMITTED = "failed: you are not admitted to this room's log yet — a member has to be online once to admit you";

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
      if (!h) return "failed: that room is gone";
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
          const target = peers.find((p) => p.name === out.peer) ?? members.find((m) => m.name === out.peer);
          if (!target) return `failed: no peer named ${out.peer} — see list-room`;
          const online = peers.some((p) => p.key === target.key);
          return yield* room.sendTo(target.key, { project: out.project, intent: out.intent, findings: out.findings, ...(out.ticketId ? { ticketId: out.ticketId } : {}) }).pipe(
            Effect.map(() => (online ? `sent to ${out.peer}` : `sent to ${out.peer} (offline — they get it when they are next online)`)),
            Effect.catchTag("NotWritable", () => Effect.succeed(NOT_ADMITTED)),
          );
        }
        case "ticket": {
          const merged = yield* room.shareTicket(out.ticket).pipe(Effect.catchTag("NotWritable", () => Effect.succeed(null)));
          return merged ? render(merged) : NOT_ADMITTED;
        }
        case "review": {
          // the record and the why, one write: the ticket first (so the
          // review it belongs to exists for everyone), then the context
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
          const say = (what: string) =>
            `TELL YOUR USER ONLY THIS: "review ticket has been ${what}". They asked for it, so the fact that it is done is the whole report — do not read the summary, the decisions, the forks or the counts back to them, and do not list what you wrote. It is on the ticket for whoever reviews it, and their TUI shows the ticket.`;
          const keepCurrent = `Next time this code changes — a fix, a fork taken differently, anything your user asks for — call ask-review again with ticketId "${out.review.ticketId}" and say what changed and why, in their words. What the room reads has to be what the code is.`;
          const held = `(${decisions.length} decision(s), ${forks.length} fork(s) now on it — for your own bookkeeping, not for your user)`;
          if (!out.ticket) return `review ticket updated [ticket ${out.review.ticketId}] ${held}. ${say("updated")} ${keepCurrent}`;
          const reviewers = out.ticket.steps.filter((s) => s.intent === "review");
          const who =
            reviewers.length === 0
              ? "in the room, nobody asked in particular"
              : `asked of ${reviewers.map((s) => nameFor(s.owner)).join(", ")}`;
          return `review ticket filed, ${who}: "${out.ticket.goal}" [ticket ${out.ticket.id}] ${held}. ${say("filed")} ${keepCurrent}`;
        }
        case "settle": {
          const ticket = (yield* SubscriptionRef.get(room.tickets)).get(out.ticketId);
          if (!ticket) return `failed: no ticket ${out.ticketId} — check get-tickets`;
          const step = ticket.steps.find((s) => s.id === out.stepId);
          if (!step) return `failed: no step ${out.stepId} on ticket ${out.ticketId}`;
          const now = yield* Clock.currentTimeMillis;
          // one rule, shared with the drive path (see p2p settleStep)
          const done = settleStep(ticket, out.stepId, identity.pubkey, out.result, out.failed, now);
          if (!done || done.outcome === "not-yours") {
            return `failed: step ${out.stepId} is ${nameFor(step.owner)}'s to settle${ticket.kind === "review" ? " — put your user's own review on the ticket with post-review" : " — say what your user thinks with send-to-peer (pass ticketId)"}`;
          }
          const merged = yield* room.shareTicket(done.ticket).pipe(Effect.catchTag("NotWritable", () => Effect.succeed(null)));
          return merged ? render(merged) : NOT_ADMITTED;
        }
        case "post-review": {
          const ticket = (yield* SubscriptionRef.get(room.tickets)).get(out.ticketId);
          if (!ticket) return `failed: no ticket ${out.ticketId} — check get-tickets`;
          const now = yield* Clock.currentTimeMillis;
          // a review lands on a step of its reader's own: nobody's is taken,
          // and posting again revises theirs
          const { ticket: updated, stepId } = postReview(ticket, { key: identity.pubkey, name: myName }, out.findings, out.failed, now);
          const merged = yield* room.shareTicket(updated).pipe(Effect.catchTag("NotWritable", () => Effect.succeed(null)));
          if (!merged) return NOT_ADMITTED;
          const others = merged.steps.filter((s) => s.intent === "review" && s.owner !== identity.pubkey).length;
          return `your review is on "${ticket.goal}" as step ${stepId}${others > 0 ? ` (beside ${others} other reader(s))` : ""} — anyone else in the room can still post theirs\n${render(merged)}`;
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
          return `attached ${attached} file(s) to "${out.goal}" — the references are on the ticket for everyone; the files go to whoever fetches them while you are online`;
        }
        case "transcript": {
          // read now, not when proposed: the file may have grown since
          const file = sessionFile(out.ai, out.sessionId, sessionDirs());
          if (!file) return `failed: no ${out.ai} session file for ${out.sessionId.slice(0, 8)}… on this machine`;
          const text = yield* Effect.sync(() => {
            try {
              return readFileSync(file, "utf8");
            } catch {
              return null;
            }
          });
          if (text === null) return `failed: could not read ${file}`;
          const { lines, entries } = sliceSince(text, out.since);
          const data = pack(lines);
          if (data.length > MAX_PACKED_BYTES) return `failed: transcript too large to send (${Math.round(data.length / 1024 / 1024)} MB packed)`;
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
              Effect.map(() => `transcript sent: ${entries} entries to ${nameFor(out.requester)}`),
              Effect.catchTag("PeerNotConnected", () => Effect.succeed(`failed: ${nameFor(out.requester)} is not connected right now — ask your user again when they are`)),
            );
        }
      }
    });

    return { perform } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
