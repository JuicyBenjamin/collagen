import { Effect, Schema, SubscriptionRef } from "effect";
import { encode as toToon } from "@toon-format/toon";
import { visibleTo } from "@collagen/p2p";
import { to } from "../app/router";
import { attachmentsDir } from "../services/Attachments";
import { transcriptsDir } from "../services/Transcripts";
import { diagnostic } from "./registry";

/** Attach files the user holds to a ticket: references on the log, the files
 *  stay home until a member fetches them. */
export const attachFiles = diagnostic<{ readonly ticketId: string; readonly files: ReadonlyArray<string>; readonly note?: string }>({
  id: "attach-files",
  title: "attach",
  summary:
    "Attach files on this machine to a ticket — a screenshot, a document, a log, a collected transcript (see list-transcripts for those paths) — so the people in the room and their agents can look at the thing itself rather than guess at it. Only when the user asks, with the paths they mean. A reference (name, size, type, who holds it; for a transcript whose conversation, which agent, how many entries) goes on the ticket for everyone at once; the file itself is sent to a member only when they fetch it while the user is online. Pass ticketId, the file paths, and optionally a note saying why.",
  params: Schema.Struct({ ticketId: Schema.String, files: Schema.Array(Schema.String), note: Schema.optional(Schema.String) }),
  fromContext: (context) => (context.ticketId ? { ticketId: context.ticketId, files: [] } : null),
  open: (context, back) => (context.ticketId ? to.attach(context.ticketId, back) : back),
  run: ({ ticketId, files, note }, context, { rooms, attachments, me }) =>
    Effect.gen(function* () {
      const handle = (yield* SubscriptionRef.get(rooms.handles)).find((candidate) => candidate.id === context.roomId);
      if (!handle) return "failed: that room is gone";
      const all = yield* SubscriptionRef.get(handle.room.tickets);
      const ticket = all.get(ticketId);
      if (!ticket || !visibleTo(ticket, all, me)) return `failed: no ticket ${ticketId} — check get-tickets`;
      if (files.length === 0) return "failed: pass the paths of the files to attach";
      return yield* attachments.attach(context.roomId, ticketId, ticket.goal, files, note);
    }),
});

/** What is attached to a ticket; fetch what we don't hold yet. */
export const fetchAttachments = diagnostic<{ readonly ticketId: string; readonly attachmentId?: string }>({
  id: "fetch-attachments",
  title: "attachments",
  summary:
    `The files attached to a ticket (name, type, size, who holds it, a note; for a transcript whose conversation and which agent) and, for each, the local path if the user already has it. Files not held are asked from their holder — they arrive only while the holder is online and are filed under ${attachmentsDir}/ticket-<id>/ (transcripts under ${transcriptsDir}/ticket-<id>/). Read the path to look at the file. Pass ticketId; attachmentId to fetch one.`,
  params: Schema.Struct({ ticketId: Schema.String, attachmentId: Schema.optional(Schema.String) }),
  // the ticket page has its own attachments section — nothing to add there
  fromContext: () => null,
  run: ({ ticketId, attachmentId }, context, { rooms, attachments }) =>
    Effect.gen(function* () {
      const handle = (yield* SubscriptionRef.get(rooms.handles)).find((candidate) => candidate.id === context.roomId);
      if (!handle) return "failed: that room is gone";
      const all = (yield* SubscriptionRef.get(handle.room.attachments)).filter((attachment) => attachment.ticketId === ticketId && (!attachmentId || attachment.id === attachmentId));
      if (all.length === 0) return attachmentId ? `failed: no attachment ${attachmentId} on ticket ${ticketId}` : "nothing attached to this ticket";
      const held = yield* attachments.held;
      const rows = [];
      for (const attachment of all) {
        const file = held[attachment.id];
        const status = file ? "held" : yield* attachments.fetch(context.roomId, attachment.id);
        rows.push({
          id: attachment.id,
          name: attachment.name,
          mime: attachment.mime,
          kb: Math.max(1, Math.round(attachment.bytes / 1024)),
          holder: attachment.holderName,
          note: attachment.note ?? "",
          transcript: attachment.transcript ? `${attachment.transcript.from} · ${attachment.transcript.ai} · ${attachment.transcript.entries} entries · since ${new Date(attachment.transcript.since).toISOString()} · from ${attachment.transcript.origin}` : "",
          attachedAt: new Date(attachment.attachedAt).toISOString(),
          file: file ?? "",
          status,
        });
      }
      return toToon({ attachments: rows });
    }),
});
