import { Effect, Schema, SubscriptionRef } from "effect";
import { encode as toToon } from "@toon-format/toon";
import { to } from "../app/router";
import { diagnostic } from "./registry";

/** Attach files the user holds to a ticket: references on the log, the files
 *  stay home until a member fetches them. */
export const attachFiles = diagnostic<{ readonly ticketId: string; readonly files: ReadonlyArray<string>; readonly note?: string }>({
  id: "attach-files",
  title: "attach",
  summary:
    "Attach files on this machine to a ticket — a screenshot, a document, a log, a collected transcript (see list-transcripts for those paths) — so the people in the room and their agents can look at the thing itself rather than guess at it. Only when the user asks, with the paths they mean. It queues in the user's outbox; on approval a reference (name, size, type, who holds it; for a transcript whose conversation, which agent, how many entries) goes on the ticket for everyone; the file itself is sent to a member only when they fetch it while the user is online. Pass ticketId, the file paths, and optionally a note saying why.",
  params: Schema.Struct({ ticketId: Schema.String, files: Schema.Array(Schema.String), note: Schema.optional(Schema.String) }),
  fromContext: (ctx) => (ctx.ticketId ? { ticketId: ctx.ticketId, files: [] } : null),
  open: (ctx, back) => (ctx.ticketId ? to.attach(ctx.ticketId, back) : back),
  run: ({ ticketId, files, note }, ctx, { rooms, attachments }) =>
    Effect.gen(function* () {
      const h = (yield* SubscriptionRef.get(rooms.handles)).find((x) => x.id === ctx.roomId);
      if (!h) return "failed: that room is gone";
      const ticket = (yield* SubscriptionRef.get(h.room.tickets)).get(ticketId);
      if (!ticket) return `failed: no ticket ${ticketId} — check get-tickets`;
      if (files.length === 0) return "failed: pass the paths of the files to attach";
      return yield* attachments.attach(ctx.roomId, ticketId, ticket.goal, files, note);
    }),
});

/** What is attached to a ticket; fetch what we don't hold yet. */
export const fetchAttachments = diagnostic<{ readonly ticketId: string; readonly attachmentId?: string }>({
  id: "fetch-attachments",
  title: "attachments",
  summary:
    "The files attached to a ticket (name, type, size, who holds it, a note; for a transcript whose conversation and which agent) and, for each, the local path if the user already has it. Files not held are asked from their holder — they arrive only while the holder is online and are filed under ~/.config/collagen/attachments/ticket-<id>/ (transcripts under ~/.config/collagen/transcripts/ticket-<id>/). Read the path to look at the file. Pass ticketId; attachmentId to fetch one.",
  params: Schema.Struct({ ticketId: Schema.String, attachmentId: Schema.optional(Schema.String) }),
  // the ticket page has its own attachments section — nothing to add there
  fromContext: () => null,
  run: ({ ticketId, attachmentId }, ctx, { rooms, attachments }) =>
    Effect.gen(function* () {
      const h = (yield* SubscriptionRef.get(rooms.handles)).find((x) => x.id === ctx.roomId);
      if (!h) return "failed: that room is gone";
      const all = (yield* SubscriptionRef.get(h.room.attachments)).filter((a) => a.ticketId === ticketId && (!attachmentId || a.id === attachmentId));
      if (all.length === 0) return attachmentId ? `failed: no attachment ${attachmentId} on ticket ${ticketId}` : "nothing attached to this ticket";
      const held = yield* attachments.held;
      const rows = [];
      for (const a of all) {
        const file = held[a.id];
        const status = file ? "held" : yield* attachments.fetch(ctx.roomId, a.id);
        rows.push({
          id: a.id,
          name: a.name,
          mime: a.mime,
          kb: Math.max(1, Math.round(a.bytes / 1024)),
          holder: a.holderName,
          note: a.note ?? "",
          transcript: a.transcript ? `${a.transcript.from} · ${a.transcript.ai} · ${a.transcript.entries} entries · since ${new Date(a.transcript.since).toISOString()} · from ${a.transcript.origin}` : "",
          attachedAt: new Date(a.attachedAt).toISOString(),
          file: file ?? "",
          status,
        });
      }
      return toToon({ attachments: rows });
    }),
});
