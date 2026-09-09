import { readFileSync } from "node:fs";
import { Clock, Context, Effect, Layer, SubscriptionRef } from "effect";
import { encode as toToon } from "@toon-format/toon";
import type { Outgoing, Ticket } from "@collagen/p2p";
import { ticketView } from "../lib/ticketView";
import { MAX_PACKED_BYTES, pack, sessionDirs, sessionFile, sliceSince } from "../lib/transcripts";
import { IdentityService } from "./Identity";
import { Rooms } from "./Rooms";

const NOT_ADMITTED = "failed: you are not admitted to this room's log yet — a member has to be online once to admit you";

/** Writes an approved Outgoing to its room's log. The only place the cli
 *  appends messages, tickets or settlements on the agent's behalf — and it is
 *  reached from the Outbox alone, after the person's yes (or a mock's). Names
 *  are resolved here, at send time, so a proposal that waited across a
 *  restart still finds its peer. */
export class Dispatch extends Context.Service<Dispatch>()("cli/Dispatch", {
  make: Effect.gen(function* () {
    const rooms = yield* Rooms;
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
          return yield* room.sendTo(target.key, { project: out.project, intent: out.intent, findings: out.findings }).pipe(
            Effect.map(() => (online ? `sent to ${out.peer}` : `sent to ${out.peer} (offline — they get it when they are next online)`)),
            Effect.catchTag("NotWritable", () => Effect.succeed(NOT_ADMITTED)),
          );
        }
        case "ticket": {
          const merged = yield* room.shareTicket(out.ticket).pipe(Effect.catchTag("NotWritable", () => Effect.succeed(null)));
          return merged ? render(merged) : NOT_ADMITTED;
        }
        case "settle": {
          const ticket = (yield* SubscriptionRef.get(room.tickets)).get(out.ticketId);
          if (!ticket) return `failed: no ticket ${out.ticketId} — check get-tickets`;
          if (!ticket.steps.some((s) => s.id === out.stepId)) return `failed: no step ${out.stepId} on ticket ${out.ticketId}`;
          const now = yield* Clock.currentTimeMillis;
          const updated: Ticket = {
            ...ticket,
            updatedAt: now,
            steps: ticket.steps.map((s) =>
              s.id === out.stepId
                ? { ...s, status: out.failed ? ("failed" as const) : ("settled" as const), result: out.result, updatedAt: now }
                : s,
            ),
          };
          const merged = yield* room.shareTicket(updated).pipe(Effect.catchTag("NotWritable", () => Effect.succeed(null)));
          return merged ? render(merged) : NOT_ADMITTED;
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
              Effect.catchTag("PeerNotConnected", () => Effect.succeed(`failed: ${nameFor(out.requester)} is not connected right now — approve again when they are`)),
            );
        }
      }
    });

    return { perform } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
