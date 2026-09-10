import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Clock, Context, Effect, Layer, Stream, SubscriptionRef } from "effect";
import { stepThreadId, type Ticket, type TranscriptAsk } from "@collagen/p2p";
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

/** Which waiting requests an answer covers — all of them when empty. */
export interface AskFilter {
  readonly subject?: string;
  readonly requester?: string;
  readonly threadId?: string;
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
const fileFor = (subject: string, from: string, threadId: string, ai: string) =>
  join(transcriptsDir, safe(subject), `${safe(from)}-${threadId}.${safe(ai)}.jsonl`);

/** Diagnostics, human in the loop: "show me how the agents behaved on this
 *  ticket". A request goes to everyone present in the room; on each machine it
 *  is *kept*, not answered — a session transcript is the one thing here that
 *  nobody asked their own agent to send, so it leaves only when that person
 *  says so (`share`), and only from the moment they adopted the thread.
 *  Answers come back directly (never on the shared log) and are filed here.
 *  The requester's own slices are filed at once: their data, their ask. */
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

    /** What peers have asked for and has not been answered. */
    const asks = Effect.gen(function* () {
      const state = yield* store.get;
      return state.transcriptAsks ?? [];
    });

    const matches = (a: TranscriptAsk, f: AskFilter) =>
      (!f.subject || a.subject === f.subject) &&
      (!f.requester || a.requesterName.toLowerCase() === f.requester.toLowerCase()) &&
      (!f.threadId || a.threadId === f.threadId);

    const drop = (f: AskFilter) => store.update((s) => ({ ...s, transcriptAsks: (s.transcriptAsks ?? []).filter((a) => !matches(a, f)) }));

    /** Take these exact asks off the list — the ones that were answered. */
    const forget = (gone: ReadonlyArray<TranscriptAsk>) =>
      store.update((s) => ({
        ...s,
        transcriptAsks: (s.transcriptAsks ?? []).filter((a) => !gone.some((g) => g.requestId === a.requestId && g.threadId === a.threadId)),
      }));

    /** Hand over the conversations a peer asked for. Nothing here happens on
     *  its own: the person said to, so it goes now. An ask whose transcript
     *  did NOT get there — the peer went offline, the slice is too big — is
     *  KEPT: the person authorised handing it over, so they should be able to
     *  say "again" rather than ask the peer to request it a second time. */
    const share = Effect.fn("Transcripts.share")(function* (f: AskFilter) {
      const waiting = (yield* asks).filter((a) => matches(a, f));
      if (waiting.length === 0) return "no transcript requests are waiting";
      const lines: Array<string> = [];
      const done: Array<TranscriptAsk> = [];
      const kept: Array<TranscriptAsk> = [];
      for (const a of waiting) {
        if (!sessionFile(a.ai, a.sessionId, sessionDirs())) {
          lines.push(`${a.requesterName} · thread ${a.threadId}: that ${a.ai} session file is gone — nothing to hand over`);
          done.push(a);
          continue;
        }
        const outcome = yield* outbox.send({
          roomId: a.roomId,
          to: a.requesterName,
          title: `${a.subject} · thread ${a.threadId} · your ${a.ai} conversation`,
          outgoing: {
            kind: "transcript",
            requestId: a.requestId,
            subject: a.subject,
            requester: a.requester,
            threadId: a.threadId,
            ai: a.ai,
            sessionId: a.sessionId,
            since: a.since,
          },
        });
        lines.push(`${a.requesterName} · thread ${a.threadId}: ${outcome.text}`);
        (outcome._tag === "sent" ? done : kept).push(a);
      }
      if (done.length > 0) yield* forget(done);
      if (kept.length > 0) {
        lines.push(
          `${kept.length} of these did not get there and are still waiting — your user already said to share them, so share-transcripts sends them again when the peer is back.`,
        );
      }
      return lines.join("\n");
    });

    /** They asked, the person said no: forget it, and tell them nothing. */
    const decline = Effect.fn("Transcripts.decline")(function* (f: AskFilter) {
      const waiting = (yield* asks).filter((a) => matches(a, f));
      if (waiting.length === 0) return "no transcript requests are waiting";
      yield* drop(f);
      return `dropped ${waiting.length} transcript request(s) — the peer is not told; tell them yourself if you want to`;
    });

    /** One room: asks are kept for the person, answers become files. */
    const attach = (h: RoomHandle) =>
      Effect.gen(function* () {
        yield* h.room.transcriptRequests.pipe(
          Stream.tap(({ from, request: req }) =>
            Effect.gen(function* () {
              const state = yield* store.get;
              const requester = yield* nameOf(h, from);
              const now = yield* Clock.currentTimeMillis;
              for (const threadId of req.threadIds) {
                const a = state.threads?.[threadId];
                if (!a || !sessionFile(a.ai, a.sessionId, sessionDirs())) continue;
                const ask: TranscriptAsk = {
                  roomId: h.id,
                  requestId: req.requestId,
                  subject: req.subject,
                  requester: from,
                  requesterName: requester,
                  threadId,
                  ai: a.ai,
                  sessionId: a.sessionId,
                  since: a.since ?? 0,
                  ts: now,
                };
                yield* store.update((s) => {
                  const kept = (s.transcriptAsks ?? []).filter((x) => !(x.requestId === ask.requestId && x.threadId === ask.threadId));
                  return { ...s, transcriptAsks: [...kept, ask] };
                });
                yield* Effect.log(`${requester} asks for your ${a.ai} conversation on thread ${threadId} (${req.subject}) — nothing has left; say the word (share-transcripts)`);
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

    return { request, threadsOfTicket, saved, list, dir: transcriptsDir, fileIncoming, asks, share, decline } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
