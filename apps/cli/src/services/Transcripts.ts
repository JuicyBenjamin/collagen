import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Clock, Context, Effect, Layer, Stream, SubscriptionRef } from "effect";
import { stepThreadId, type Ticket } from "@collagen/p2p";
import { sessionDirs, sessionFile, sliceSince, unpack } from "../lib/transcripts";
import { configDir, IdentityService } from "./Identity";
import { Outbox } from "./Outbox";
import { Rooms, type RoomHandle } from "./Rooms";
import { StateStore } from "./StateStore";

/** Where handed-over conversations land: `<subject>/<peer>-<threadId>.<ai>.jsonl`. */
export const transcriptsDir = join(configDir, "transcripts");

export interface SavedTranscript {
  readonly subject: string;
  readonly from: string;
  readonly threadId: string;
  readonly ai: string;
  readonly entries: number;
  readonly path: string;
}

/** Provenance, written next to each transcript as `<file>.meta.json`: the
 *  filename says who and which agent at the time; this says the rest. */
export interface TranscriptMeta {
  readonly subject: string;
  readonly from: string;
  readonly fromKey: string;
  readonly ai: string;
  readonly threadId: string;
  readonly sessionId: string;
  /** The slice starts here (their adoption time), ms. */
  readonly since: number;
  readonly entries: number;
  readonly receivedAt: number;
  readonly requestId: string;
  /** When attached to a ticket from elsewhere: the subject it was first filed under. */
  readonly origin?: string;
  /** Who handed it over, when that is not whose conversation it is. */
  readonly via?: string;
}

export interface ListedTranscript {
  readonly subject: string;
  readonly file: string;
  readonly bytes: number;
  readonly meta: TranscriptMeta | null;
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
const fileFor = (subject: string, from: string, threadId: string, ai: string) =>
  join(transcriptsDir, safe(subject), `${safe(from)}-${threadId}.${safe(ai)}.jsonl`);

/** Diagnostics, human in the loop: "show me how the agents behaved on this
 *  ticket". A request goes to everyone present in the room; on each machine it
 *  becomes a proposal in that person's outbox — their conversation leaves only
 *  when they say so, and only from the moment they adopted the thread. Answers
 *  come back directly (never on the shared log) and are filed here. The
 *  requester's own slices are filed at once: their data, their ask. */
export class Transcripts extends Context.Service<Transcripts>()("cli/Transcripts", {
  make: Effect.gen(function* () {
    const rooms = yield* Rooms;
    const outbox = yield* Outbox;
    const store = yield* StateStore;
    const { identity, nameRef } = yield* IdentityService;
    const saved = yield* SubscriptionRef.make<ReadonlyArray<SavedTranscript>>([]);

    const nameOf = (h: RoomHandle, key: string) =>
      Effect.gen(function* () {
        const peers = yield* SubscriptionRef.get(h.room.roster);
        const members = yield* SubscriptionRef.get(h.room.members);
        return peers.find((p) => p.key === key)?.name ?? members.find((m) => m.key === key)?.name ?? key.slice(0, 8);
      });

    const file = (entry: SavedTranscript, text: string, meta: TranscriptMeta) =>
      Effect.gen(function* () {
        mkdirSync(dirname(entry.path), { recursive: true });
        writeFileSync(entry.path, text);
        writeFileSync(`${entry.path}.meta.json`, JSON.stringify(meta, null, 2));
        yield* SubscriptionRef.update(saved, (s) => [...s.filter((x) => x.path !== entry.path), entry]);
      });

    /** The threads a ticket's steps travel on (creator ↔ each owner). */
    const threadsOfTicket = (ticket: Ticket): ReadonlyArray<string> => [...new Set(ticket.steps.map((s) => stepThreadId(ticket, s)))];

    /** Ask the room. Our own adopted conversations on these threads are filed
     *  first, then everyone present is asked; each answer is their call. */
    const request = Effect.fn("Transcripts.request")(function* (roomId: string, subject: string, threadIds: ReadonlyArray<string>) {
      const h = (yield* SubscriptionRef.get(rooms.handles)).find((x) => x.id === roomId);
      if (!h) return { asked: 0, own: 0, dir: join(transcriptsDir, safe(subject)) };
      const state = yield* store.get;
      const me = yield* SubscriptionRef.get(nameRef);
      let own = 0;
      for (const threadId of threadIds) {
        const a = state.threads?.[threadId];
        if (!a) continue;
        const path = sessionFile(a.ai, a.sessionId, sessionDirs());
        if (!path) continue;
        const { lines, entries } = sliceSince(readFileSync(path, "utf8"), a.since ?? 0);
        const now = yield* Clock.currentTimeMillis;
        yield* file(
          { subject, from: me, threadId, ai: a.ai, entries, path: fileFor(subject, me, threadId, a.ai) },
          lines.join("\n") + "\n",
          { subject, from: me, fromKey: identity.pubkey, ai: a.ai, threadId, sessionId: a.sessionId, since: a.since ?? 0, entries, receivedAt: now, requestId: "own" },
        );
        own++;
      }
      const asked = yield* h.room.requestTranscripts({ requestId: crypto.randomUUID(), subject, threadIds });
      yield* Effect.log(`transcripts: asked ${asked} peer(s) about ${subject} (${threadIds.length} thread(s)); ${own} of our own filed`);
      return { asked, own, dir: join(transcriptsDir, safe(subject)) };
    });

    /** One room: asks become proposals, answers become files. */
    const attach = (h: RoomHandle) =>
      Effect.gen(function* () {
        yield* h.room.transcriptRequests.pipe(
          Stream.tap(({ from, request: req }) =>
            Effect.gen(function* () {
              const state = yield* store.get;
              const requester = yield* nameOf(h, from);
              for (const threadId of req.threadIds) {
                const a = state.threads?.[threadId];
                if (!a || !sessionFile(a.ai, a.sessionId, sessionDirs())) continue;
                yield* Effect.log(`${requester} asks for your ${a.ai} conversation on thread ${threadId} (${req.subject}) — in your outbox`);
                yield* outbox.propose({
                  roomId: h.id,
                  to: requester,
                  title: `${req.subject} · thread ${threadId} · your ${a.ai} conversation`,
                  outgoing: {
                    kind: "transcript",
                    requestId: req.requestId,
                    subject: req.subject,
                    requester: from,
                    threadId,
                    ai: a.ai,
                    sessionId: a.sessionId,
                    since: a.since ?? 0,
                  },
                });
              }
            }),
          ),
          Stream.runDrain,
          Effect.forkScoped,
        );
        yield* h.room.transcripts.pipe(
          Stream.tap(({ from, transcript: t }) =>
            Effect.gen(function* () {
              const name = yield* nameOf(h, from);
              const now = yield* Clock.currentTimeMillis;
              const entry: SavedTranscript = { subject: t.subject, from: name, threadId: t.threadId, ai: t.ai, entries: t.entries, path: fileFor(t.subject, name, t.threadId, t.ai) };
              yield* file(entry, unpack(t.data), {
                subject: t.subject,
                from: name,
                fromKey: from,
                ai: t.ai,
                threadId: t.threadId,
                sessionId: t.sessionId,
                since: t.since,
                entries: t.entries,
                receivedAt: now,
                requestId: t.requestId,
              });
              yield* Effect.log(`transcript from ${name}: ${t.entries} entries → ${entry.path}`);
            }),
          ),
          Stream.runDrain,
          Effect.forkScoped,
        );
      });

    /** File a transcript that reached us some other way (an attachment
     *  fetched from a ticket): where every transcript goes, meta beside it.
     *  Returns the path. */
    const fileIncoming = Effect.fn("Transcripts.fileIncoming")(function* (meta: TranscriptMeta, text: string) {
      const path = fileFor(meta.subject, meta.from, meta.threadId, meta.ai);
      yield* file({ subject: meta.subject, from: meta.from, threadId: meta.threadId, ai: meta.ai, entries: meta.entries, path }, text, meta);
      return path;
    });

    // every room, as it appears (a room that leaves ends its own streams)
    const attached = new Set<string>();
    yield* SubscriptionRef.changes(rooms.handles).pipe(
      Stream.tap((hs) =>
        Effect.forEach(
          hs.filter((h) => !attached.has(h.id)),
          (h) => {
            attached.add(h.id);
            return attach(h);
          },
          { discard: true },
        ),
      ),
      Stream.runDrain,
      Effect.forkScoped,
    );

    /** Everything filed so far, from disk (survives restarts). */
    const list = Effect.sync((): ReadonlyArray<ListedTranscript> => {
      const out: Array<ListedTranscript> = [];
      const readMeta = (path: string): TranscriptMeta | null => {
        try {
          return JSON.parse(readFileSync(`${path}.meta.json`, "utf8")) as TranscriptMeta;
        } catch {
          return null;
        }
      };
      let subjects: Array<string>;
      try {
        subjects = readdirSync(transcriptsDir);
      } catch {
        return out;
      }
      for (const subject of subjects) {
        const dir = join(transcriptsDir, subject);
        try {
          for (const f of readdirSync(dir)) {
            if (f.endsWith(".meta.json")) continue;
            const file = join(dir, f);
            out.push({ subject, file, bytes: statSync(file).size, meta: readMeta(file) });
          }
        } catch {
          /* not a dir */
        }
      }
      return out;
    });

    return { request, threadsOfTicket, saved, list, dir: transcriptsDir, fileIncoming } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
