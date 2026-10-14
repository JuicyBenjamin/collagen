import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Clock, Context, Effect, Layer, Stream, SubscriptionRef } from "effect";
import type { Attachment } from "@collagen/p2p";
import { describeFile, MAX_ATTACHMENT_BYTES, packBytes, safeName, unpackBytes } from "../lib/attachments";
import { configDir } from "./Identity";
import { Outbox } from "./Outbox";
import { Rooms, type RoomHandle } from "./Rooms";
import { StateStore } from "./StateStore";
import { Transcripts } from "./Transcripts";

/** Where fetched files land: `ticket-<id8>/<attachment id8>-<name>`, each
 *  with a `.meta.json` beside it (the Attachment record + when it arrived).
 *  Transcripts are the exception: they go where every transcript goes. */
export const attachmentsDir = join(configDir, "attachments");

/** A fetched attachment's meta file. */
export interface AttachmentMeta extends Attachment {
  readonly receivedAt: number;
}

export interface HeldAttachment {
  readonly attachmentId: string;
  readonly file: string;
  readonly meta: AttachmentMeta | null;
}

/** Files on a ticket, human in the loop. Attaching puts a reference on the
 *  room's log — name, size, type, who holds it, and for a transcript its
 *  meta — and records it in the outbox. The file itself
 *  stays home. A member who wants it fetches it; the holder's collagen
 *  answers with the bytes if they are online and the id is one they
 *  attached (nothing else ever leaves), and it is filed here. Screenshots,
 *  documents, transcripts: the agents read the thing, not a guess at it. */
export class Attachments extends Context.Service<Attachments>()("cli/Attachments", {
  make: Effect.gen(function* () {
    const rooms = yield* Rooms;
    const outbox = yield* Outbox;
    const store = yield* StateStore;
    const transcripts = yield* Transcripts;
    /** Bumps when a fetched file lands — for the UI to re-read what we hold. */
    const saved = yield* SubscriptionRef.make<ReadonlyArray<HeldAttachment>>([]);

    const nameOf = (handle: RoomHandle, key: string) =>
      Effect.gen(function* () {
        const peers = yield* SubscriptionRef.get(handle.room.roster);
        const members = yield* SubscriptionRef.get(handle.room.members);
        return peers.find((peer) => peer.key === key)?.name ?? members.find((member) => member.key === key)?.name ?? key.slice(0, 8);
      });

    const subjectOf = (attachment: Attachment) => `ticket-${attachment.ticketId.slice(0, 8)}`;

    /** Fetched files on disk, by attachment id (survives restarts). */
    const fetched = Effect.sync((): ReadonlyArray<HeldAttachment> => {
      const out: Array<HeldAttachment> = [];
      let subjects: Array<string>;
      try {
        subjects = readdirSync(attachmentsDir);
      } catch {
        return out;
      }
      for (const subject of subjects) {
        const dir = join(attachmentsDir, subject);
        try {
          for (const fileName of readdirSync(dir)) {
            if (!fileName.endsWith(".meta.json")) continue;
            const file = join(dir, fileName.slice(0, -".meta.json".length));
            try {
              const meta = JSON.parse(readFileSync(join(dir, fileName), "utf8")) as AttachmentMeta;
              statSync(file);
              out.push({ attachmentId: meta.id, file, meta });
            } catch {
              /* a stray meta file */
            }
          }
        } catch {
          /* not a dir */
        }
      }
      return out;
    });

    /** Every attachment whose file is on this machine: fetched ones, fetched
     *  transcripts (filed with the transcripts), and the ones we attached. */
    const held = Effect.gen(function* () {
      const out: Record<string, string> = {};
      for (const listed of yield* fetched) out[listed.attachmentId] = listed.file;
      for (const listed of yield* transcripts.list) if (listed.meta?.requestId) out[listed.meta.requestId] = listed.file;
      // what we attached ourselves wins: the original, where the person put it
      Object.assign(out, (yield* store.get).attachedFiles ?? {});
      return out;
    });

    /** Attach files you hold (paths) to a ticket: a proposal in your outbox;
     *  the references go on the log, the files stay with you. */
    const attach = Effect.fn("Attachments.attach")(function* (roomId: string, ticketId: string, goal: string, paths: ReadonlyArray<string>, note?: string) {
      const items = [];
      for (const path of paths) {
        const item = describeFile(path);
        if (!item) return `failed: ${path} is not a file on this machine`;
        if (item.bytes > MAX_ATTACHMENT_BYTES) return `failed: ${item.name} is ${Math.round(item.bytes / 1024 / 1024)} MB — attachments stop at ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`;
        items.push(item);
      }
      if (items.length === 0) return "failed: nothing to attach";
      return yield* outbox.tell({
        roomId,
        to: "the room",
        title: `${goal} · attach ${items.length} file(s)`,
        outgoing: { kind: "attach", ticketId, goal, items, ...(note ? { note } : {}) },
      });
    });

    /** Ask the holder for an attachment; it is filed when it arrives. Needs
     *  both online. */
    const fetch = Effect.fn("Attachments.fetch")(function* (roomId: string, attachmentId: string) {
      const handle = (yield* SubscriptionRef.get(rooms.handles)).find((candidate) => candidate.id === roomId);
      if (!handle) return "failed: that room is gone";
      const attachment = (yield* SubscriptionRef.get(handle.room.attachments)).find((candidate) => candidate.id === attachmentId);
      if (!attachment) return `failed: no attachment ${attachmentId.slice(0, 8)} on this room's tickets`;
      const have = (yield* held)[attachmentId];
      if (have) return `already here: ${have}`;
      return yield* handle.room.fetchAttachment(attachment.holder, attachmentId).pipe(
        Effect.map(() => `asked ${attachment.holderName} for ${attachment.name} — it is filed under ${subjectOf(attachment)} when it arrives`),
        Effect.catchTag("PeerNotConnected", () => Effect.succeed(`${attachment.holderName} is not online — fetch when they are`)),
      );
    });

    /** One room: answer fetches for what we attached; file what we fetched. */
    const wire = (handle: RoomHandle) =>
      Effect.gen(function* () {
        yield* handle.room.fetchRequests.pipe(
          Stream.tap(({ from, attachmentId }) =>
            Effect.gen(function* () {
              const path = (yield* store.get).attachedFiles?.[attachmentId];
              const attachment = (yield* SubscriptionRef.get(handle.room.attachments)).find((candidate) => candidate.id === attachmentId);
              const who = yield* nameOf(handle, from);
              if (!path || !attachment) return yield* Effect.logWarning(`${who} asked for attachment ${attachmentId.slice(0, 8)} we never attached — ignored`);
              const bytes = yield* Effect.sync(() => {
                try {
                  return readFileSync(path);
                } catch {
                  return null;
                }
              });
              if (bytes === null) return yield* Effect.logWarning(`attachment ${attachment.name}: the file is gone (${path})`);
              yield* handle.room.sendAttachment(from, { attachmentId, data: packBytes(bytes) }).pipe(Effect.catchTag("PeerNotConnected", () => Effect.void));
              yield* Effect.log(`${who} fetched ${attachment.name} (${Math.max(1, Math.round(bytes.length / 1024))} kB)`);
            }),
          ),
          Stream.runDrain,
          Effect.forkScoped,
        );
        yield* handle.room.attachmentsIn.pipe(
          Stream.tap(({ from, attachment: incoming }) =>
            Effect.gen(function* () {
              const attachment = (yield* SubscriptionRef.get(handle.room.attachments)).find((candidate) => candidate.id === incoming.attachmentId);
              const sender = yield* nameOf(handle, from);
              if (!attachment) return yield* Effect.logWarning(`${sender} sent attachment ${incoming.attachmentId.slice(0, 8)} that is on no ticket here — dropped`);
              if (attachment.holder !== from) return yield* Effect.logWarning(`${sender} sent ${attachment.name} but ${attachment.holderName} holds it — dropped`);
              const bytes = unpackBytes(incoming.data);
              const now = yield* Clock.currentTimeMillis;
              if (attachment.transcript) {
                const transcript = attachment.transcript;
                const path = yield* transcripts.fileIncoming(
                  {
                    subject: subjectOf(attachment),
                    from: transcript.from,
                    fromKey: from,
                    ai: transcript.ai,
                    threadId: transcript.threadId,
                    sessionId: transcript.sessionId,
                    since: transcript.since,
                    entries: transcript.entries,
                    receivedAt: now,
                    requestId: attachment.id,
                    origin: transcript.origin,
                    ...(transcript.from !== attachment.holderName ? { via: attachment.holderName } : {}),
                  },
                  bytes.toString("utf8"),
                );
                yield* SubscriptionRef.update(saved, (filed) => [...filed.filter((existing) => existing.attachmentId !== attachment.id), { attachmentId: attachment.id, file: path, meta: null }]);
                yield* Effect.log(`fetched ${attachment.name} from ${sender} (transcript, ${transcript.entries} entries) → ${path}`);
                return;
              }
              const dir = join(attachmentsDir, subjectOf(attachment));
              const path = join(dir, `${attachment.id.slice(0, 8)}-${safeName(attachment.name)}`);
              const meta: AttachmentMeta = { ...attachment, receivedAt: now };
              mkdirSync(dir, { recursive: true });
              writeFileSync(path, bytes);
              writeFileSync(`${path}.meta.json`, JSON.stringify(meta, null, 2));
              yield* SubscriptionRef.update(saved, (filed) => [...filed.filter((existing) => existing.attachmentId !== attachment.id), { attachmentId: attachment.id, file: path, meta }]);
              yield* Effect.log(`fetched ${attachment.name} from ${sender} (${attachment.mime}, ${Math.max(1, Math.round(bytes.length / 1024))} kB) → ${path}`);
            }),
          ),
          Stream.runDrain,
          Effect.forkScoped,
        );
      });

    // every room, as it appears (a room that leaves ends its own streams)
    const wired = new Set<string>();
    yield* SubscriptionRef.changes(rooms.handles).pipe(
      Stream.tap((handles) =>
        Effect.forEach(
          handles.filter((handle) => !wired.has(handle.id)),
          (handle) => {
            wired.add(handle.id);
            return wire(handle);
          },
          { discard: true },
        ),
      ),
      Stream.runDrain,
      Effect.forkScoped,
    );

    return { attach, fetch, held, saved, dir: attachmentsDir } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
