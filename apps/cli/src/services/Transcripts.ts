import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Context, Effect, Layer, Stream, SubscriptionRef } from "effect";
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
    const { nameRef } = yield* IdentityService;
    const saved = yield* SubscriptionRef.make<ReadonlyArray<SavedTranscript>>([]);

    const nameOf = (h: RoomHandle, key: string) =>
      Effect.gen(function* () {
        const peers = yield* SubscriptionRef.get(h.room.roster);
        const members = yield* SubscriptionRef.get(h.room.members);
        return peers.find((p) => p.key === key)?.name ?? members.find((m) => m.key === key)?.name ?? key.slice(0, 8);
      });

    const file = (entry: SavedTranscript, text: string) =>
      Effect.gen(function* () {
        mkdirSync(dirname(entry.path), { recursive: true });
        writeFileSync(entry.path, text);
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
        yield* file({ subject, from: me, threadId, ai: a.ai, entries, path: fileFor(subject, me, threadId, a.ai) }, lines.join("\n") + "\n");
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
              const entry: SavedTranscript = { subject: t.subject, from: name, threadId: t.threadId, ai: t.ai, entries: t.entries, path: fileFor(t.subject, name, t.threadId, t.ai) };
              yield* file(entry, unpack(t.data));
              yield* Effect.log(`transcript from ${name}: ${t.entries} entries → ${entry.path}`);
            }),
          ),
          Stream.runDrain,
          Effect.forkScoped,
        );
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
    const list = Effect.sync((): ReadonlyArray<{ subject: string; file: string; bytes: number }> => {
      const out: Array<{ subject: string; file: string; bytes: number }> = [];
      let subjects: Array<string>;
      try {
        subjects = readdirSync(transcriptsDir);
      } catch {
        return out;
      }
      for (const subject of subjects) {
        const dir = join(transcriptsDir, subject);
        try {
          for (const f of readdirSync(dir)) out.push({ subject, file: join(dir, f), bytes: statSync(join(dir, f)).size });
        } catch {
          /* not a dir */
        }
      }
      return out;
    });

    return { request, threadsOfTicket, saved, list, dir: transcriptsDir } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
