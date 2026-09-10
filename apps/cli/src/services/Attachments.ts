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

    const nameOf = (h: RoomHandle, key: string) =>
      Effect.gen(function* () {
        const peers = yield* SubscriptionRef.get(h.room.roster);
        const members = yield* SubscriptionRef.get(h.room.members);
        return peers.find((p) => p.key === key)?.name ?? members.find((m) => m.key === key)?.name ?? key.slice(0, 8);
      });

    const subjectOf = (a: Attachment) => `ticket-${a.ticketId.slice(0, 8)}`;

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
          for (const f of readdirSync(dir)) {
            if (!f.endsWith(".meta.json")) continue;
            const file = join(dir, f.slice(0, -".meta.json".length));
            try {
              const meta = JSON.parse(readFileSync(join(dir, f), "utf8")) as AttachmentMeta;
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
      for (const f of yield* fetched) out[f.attachmentId] = f.file;
      for (const f of yield* transcripts.list) if (f.meta?.requestId) out[f.meta.requestId] = f.file;
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
      return yield* outbox.send({
        roomId,
        to: "the room",
        title: `${goal} · attach ${items.length} file(s)`,
        outgoing: { kind: "attach", ticketId, goal, items, ...(note ? { note } : {}) },
      });
    });

    /** Ask the holder for an attachment; it is filed when it arrives. Needs
     *  both online. */
    const fetch = Effect.fn("Attachments.fetch")(function* (roomId: string, attachmentId: string) {
      const h = (yield* SubscriptionRef.get(rooms.handles)).find((x) => x.id === roomId);
      if (!h) return "failed: that room is gone";
      const a = (yield* SubscriptionRef.get(h.room.attachments)).find((x) => x.id === attachmentId);
      if (!a) return `failed: no attachment ${attachmentId.slice(0, 8)} on this room's tickets`;
      const have = (yield* held)[attachmentId];
      if (have) return `already here: ${have}`;
      return yield* h.room.fetchAttachment(a.holder, attachmentId).pipe(
        Effect.map(() => `asked ${a.holderName} for ${a.name} — it is filed under ${subjectOf(a)} when it arrives`),
        Effect.catchTag("PeerNotConnected", () => Effect.succeed(`${a.holderName} is not online — fetch when they are`)),
      );
    });

    /** One room: answer fetches for what we attached; file what we fetched. */
    const wire = (h: RoomHandle) =>
      Effect.gen(function* () {
        yield* h.room.fetchRequests.pipe(
          Stream.tap(({ from, attachmentId }) =>
            Effect.gen(function* () {
              const path = (yield* store.get).attachedFiles?.[attachmentId];
              const a = (yield* SubscriptionRef.get(h.room.attachments)).find((x) => x.id === attachmentId);
              const who = yield* nameOf(h, from);
              if (!path || !a) return yield* Effect.logWarning(`${who} asked for attachment ${attachmentId.slice(0, 8)} we never attached — ignored`);
              const bytes = yield* Effect.sync(() => {
                try {
                  return readFileSync(path);
                } catch {
                  return null;
                }
              });
              if (bytes === null) return yield* Effect.logWarning(`attachment ${a.name}: the file is gone (${path})`);
              yield* h.room.sendAttachment(from, { attachmentId, data: packBytes(bytes) }).pipe(Effect.catchTag("PeerNotConnected", () => Effect.void));
              yield* Effect.log(`${who} fetched ${a.name} (${Math.max(1, Math.round(bytes.length / 1024))} kB)`);
            }),
          ),
          Stream.runDrain,
          Effect.forkScoped,
        );
        yield* h.room.attachmentsIn.pipe(
          Stream.tap(({ from, attachment: f }) =>
            Effect.gen(function* () {
              const a = (yield* SubscriptionRef.get(h.room.attachments)).find((x) => x.id === f.attachmentId);
              const sender = yield* nameOf(h, from);
              if (!a) return yield* Effect.logWarning(`${sender} sent attachment ${f.attachmentId.slice(0, 8)} that is on no ticket here — dropped`);
              if (a.holder !== from) return yield* Effect.logWarning(`${sender} sent ${a.name} but ${a.holderName} holds it — dropped`);
              const bytes = unpackBytes(f.data);
              const now = yield* Clock.currentTimeMillis;
              if (a.transcript) {
                const t = a.transcript;
                const path = yield* transcripts.fileIncoming(
                  {
                    subject: subjectOf(a),
                    from: t.from,
                    fromKey: from,
                    ai: t.ai,
                    threadId: t.threadId,
                    sessionId: t.sessionId,
                    since: t.since,
                    entries: t.entries,
                    receivedAt: now,
                    requestId: a.id,
                    origin: t.origin,
                    ...(t.from !== a.holderName ? { via: a.holderName } : {}),
                  },
                  bytes.toString("utf8"),
                );
                yield* SubscriptionRef.update(saved, (s) => [...s.filter((x) => x.attachmentId !== a.id), { attachmentId: a.id, file: path, meta: null }]);
                yield* Effect.log(`fetched ${a.name} from ${sender} (transcript, ${t.entries} entries) → ${path}`);
                return;
              }
              const dir = join(attachmentsDir, subjectOf(a));
              const path = join(dir, `${a.id.slice(0, 8)}-${safeName(a.name)}`);
              const meta: AttachmentMeta = { ...a, receivedAt: now };
              mkdirSync(dir, { recursive: true });
              writeFileSync(path, bytes);
              writeFileSync(`${path}.meta.json`, JSON.stringify(meta, null, 2));
              yield* SubscriptionRef.update(saved, (s) => [...s.filter((x) => x.attachmentId !== a.id), { attachmentId: a.id, file: path, meta }]);
              yield* Effect.log(`fetched ${a.name} from ${sender} (${a.mime}, ${Math.max(1, Math.round(bytes.length / 1024))} kB) → ${path}`);
            }),
          ),
          Stream.runDrain,
          Effect.forkScoped,
        );
      });

    // every room, as it appears (a room that leaves ends its own streams)
    const wired = new Set<string>();
    yield* SubscriptionRef.changes(rooms.handles).pipe(
      Stream.tap((hs) =>
        Effect.forEach(
          hs.filter((h) => !wired.has(h.id)),
          (h) => {
            wired.add(h.id);
            return wire(h);
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
