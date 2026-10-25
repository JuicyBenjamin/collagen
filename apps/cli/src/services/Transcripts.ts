import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Clock, Context, Effect, Layer, Stream, SubscriptionRef } from "effect";
import { stepThreadId, type Ticket, type TranscriptAsk } from "@collagen/p2p";
import { sliceSince, unpack } from "../lib/transcripts";
import { harnessFor, Harnesses, transcriptFile } from "./Harness";
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

const safe = (segment: string) => segment.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
const fileFor = (subject: string, from: string, threadId: string, aiName: string) =>
  join(transcriptsDir, safe(subject), `${safe(from)}-${threadId}.${safe(aiName)}.jsonl`);

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
    const harnesses = yield* Harnesses;
    const { identity, nameRef } = yield* IdentityService;
    const saved = yield* SubscriptionRef.make<ReadonlyArray<SavedTranscript>>([]);

    const nameOf = (handle: RoomHandle, key: string) =>
      Effect.gen(function* () {
        const peers = yield* SubscriptionRef.get(handle.room.roster);
        const members = yield* SubscriptionRef.get(handle.room.members);
        return peers.find((peer) => peer.key === key)?.name ?? members.find((member) => member.key === key)?.name ?? key.slice(0, 8);
      });

    const file = (entry: SavedTranscript, text: string, meta: TranscriptMeta) =>
      Effect.gen(function* () {
        mkdirSync(dirname(entry.path), { recursive: true });
        writeFileSync(entry.path, text);
        writeFileSync(`${entry.path}.meta.json`, JSON.stringify(meta, null, 2));
        yield* SubscriptionRef.update(saved, (filed) => [...filed.filter((transcript) => transcript.path !== entry.path), entry]);
      });

    /** The threads a ticket's steps travel on (creator ↔ each owner). */
    const threadsOfTicket = (ticket: Ticket): ReadonlyArray<string> => [...new Set(ticket.steps.map((step) => stepThreadId(ticket, step)))];

    /** Ask the room. Our own adopted conversations on these threads are filed
     *  first, then everyone present is asked; each answer is their call. */
    const request = Effect.fn("Transcripts.request")(function* (roomId: string, subject: string, threadIds: ReadonlyArray<string>) {
      const handle = (yield* SubscriptionRef.get(rooms.handles)).find((candidate) => candidate.id === roomId);
      if (!handle) return { asked: 0, own: 0, dir: join(transcriptsDir, safe(subject)) };
      const state = yield* store.get;
      const me = yield* SubscriptionRef.get(nameRef);
      let own = 0;
      for (const threadId of threadIds) {
        const adopted = state.threads?.[threadId];
        if (!adopted) continue;
        const path = transcriptFile(harnesses, adopted.ai, adopted.sessionId);
        if (!path) continue;
        const { lines, entries } = sliceSince(readFileSync(path, "utf8"), adopted.since ?? 0, harnessFor(harnesses, adopted.ai)?.keepsWhole ?? (() => false));
        const now = yield* Clock.currentTimeMillis;
        yield* file(
          { subject, from: me, threadId, ai: adopted.ai, entries, path: fileFor(subject, me, threadId, adopted.ai) },
          lines.join("\n") + "\n",
          { subject, from: me, fromKey: identity.pubkey, ai: adopted.ai, threadId, sessionId: adopted.sessionId, since: adopted.since ?? 0, entries, receivedAt: now, requestId: "own" },
        );
        own++;
      }
      const asked = yield* handle.room.requestTranscripts({ requestId: crypto.randomUUID(), subject, threadIds });
      yield* Effect.log(`transcripts: asked ${asked} peer(s) about ${subject} (${threadIds.length} thread(s)); ${own} of our own filed`);
      return { asked, own, dir: join(transcriptsDir, safe(subject)) };
    });

    /** What peers have asked for and has not been answered. */
    const asks = Effect.gen(function* () {
      const state = yield* store.get;
      return state.transcriptAsks ?? [];
    });

    const matches = (ask: TranscriptAsk, filter: AskFilter) =>
      (!filter.subject || ask.subject === filter.subject) &&
      (!filter.requester || ask.requesterName.toLowerCase() === filter.requester.toLowerCase()) &&
      (!filter.threadId || ask.threadId === filter.threadId);

    const drop = (filter: AskFilter) => store.update((state) => ({ ...state, transcriptAsks: (state.transcriptAsks ?? []).filter((ask) => !matches(ask, filter)) }));

    /** Take these exact asks off the list — the ones that were answered. */
    const forget = (gone: ReadonlyArray<TranscriptAsk>) =>
      store.update((state) => ({
        ...state,
        transcriptAsks: (state.transcriptAsks ?? []).filter((ask) => !gone.some((answered) => answered.requestId === ask.requestId && answered.threadId === ask.threadId)),
      }));

    /** Hand over the conversations a peer asked for. Nothing here happens on
     *  its own: the person said to, so it goes now. An ask whose transcript
     *  did NOT get there — the peer went offline, the slice is too big — is
     *  KEPT: the person authorised handing it over, so they should be able to
     *  say "again" rather than ask the peer to request it a second time. */
    const share = Effect.fn("Transcripts.share")(function* (filter: AskFilter) {
      const waiting = (yield* asks).filter((ask) => matches(ask, filter));
      if (waiting.length === 0) return "no transcript requests are waiting";
      const lines: Array<string> = [];
      const done: Array<TranscriptAsk> = [];
      const kept: Array<TranscriptAsk> = [];
      for (const ask of waiting) {
        if (!transcriptFile(harnesses, ask.ai, ask.sessionId)) {
          lines.push(`${ask.requesterName} · thread ${ask.threadId}: that ${ask.ai} session file is gone — nothing to hand over`);
          done.push(ask);
          continue;
        }
        const outcome = yield* outbox.send({
          roomId: ask.roomId,
          to: ask.requesterName,
          title: `${ask.subject} · thread ${ask.threadId} · your ${ask.ai} conversation`,
          outgoing: {
            kind: "transcript",
            requestId: ask.requestId,
            subject: ask.subject,
            requester: ask.requester,
            threadId: ask.threadId,
            ai: ask.ai,
            sessionId: ask.sessionId,
            since: ask.since,
          },
        });
        lines.push(`${ask.requesterName} · thread ${ask.threadId}: ${outcome.text}`);
        (outcome._tag === "sent" ? done : kept).push(ask);
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
    const decline = Effect.fn("Transcripts.decline")(function* (filter: AskFilter) {
      const waiting = (yield* asks).filter((ask) => matches(ask, filter));
      if (waiting.length === 0) return "no transcript requests are waiting";
      yield* drop(filter);
      return `dropped ${waiting.length} transcript request(s) — the peer is not told; tell them yourself if you want to`;
    });

    /** One room: asks are kept for the person, answers become files. */
    const attach = (handle: RoomHandle) =>
      Effect.gen(function* () {
        yield* handle.room.transcriptRequests.pipe(
          Stream.tap(({ from, request: transcriptRequest }) =>
            Effect.gen(function* () {
              const state = yield* store.get;
              const requester = yield* nameOf(handle, from);
              const now = yield* Clock.currentTimeMillis;
              for (const threadId of transcriptRequest.threadIds) {
                const adopted = state.threads?.[threadId];
                if (!adopted || !transcriptFile(harnesses, adopted.ai, adopted.sessionId)) continue;
                const ask: TranscriptAsk = {
                  roomId: handle.id,
                  requestId: transcriptRequest.requestId,
                  subject: transcriptRequest.subject,
                  requester: from,
                  requesterName: requester,
                  threadId,
                  ai: adopted.ai,
                  sessionId: adopted.sessionId,
                  since: adopted.since ?? 0,
                  ts: now,
                };
                yield* store.update((current) => {
                  const kept = (current.transcriptAsks ?? []).filter((existing) => !(existing.requestId === ask.requestId && existing.threadId === ask.threadId));
                  return { ...current, transcriptAsks: [...kept, ask] };
                });
                yield* Effect.log(`${requester} asks for your ${adopted.ai} conversation on thread ${threadId} (${transcriptRequest.subject}) — nothing has left; say the word (share-transcripts)`);
              }
            }),
          ),
          Stream.runDrain,
          Effect.forkScoped,
        );
        yield* handle.room.transcripts.pipe(
          Stream.tap(({ from, transcript }) =>
            Effect.gen(function* () {
              const name = yield* nameOf(handle, from);
              const now = yield* Clock.currentTimeMillis;
              const entry: SavedTranscript = { subject: transcript.subject, from: name, threadId: transcript.threadId, ai: transcript.ai, entries: transcript.entries, path: fileFor(transcript.subject, name, transcript.threadId, transcript.ai) };
              yield* file(entry, unpack(transcript.data), {
                subject: transcript.subject,
                from: name,
                fromKey: from,
                ai: transcript.ai,
                threadId: transcript.threadId,
                sessionId: transcript.sessionId,
                since: transcript.since,
                entries: transcript.entries,
                receivedAt: now,
                requestId: transcript.requestId,
              });
              yield* Effect.log(`transcript from ${name}: ${transcript.entries} entries → ${entry.path}`);
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
      Stream.tap((handles) =>
        Effect.forEach(
          handles.filter((handle) => !attached.has(handle.id)),
          (handle) => {
            attached.add(handle.id);
            return attach(handle);
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
          for (const fileName of readdirSync(dir)) {
            if (fileName.endsWith(".meta.json")) continue;
            const file = join(dir, fileName);
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
