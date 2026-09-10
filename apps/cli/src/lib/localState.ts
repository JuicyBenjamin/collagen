import { Option, Schema } from "effect";
import { AdoptedThread, LocalState, Project, Proposal, TranscriptAsk } from "@collagen/p2p";

/** Reading the user's own state file must never cost them their rooms.
 *
 *  One protocol version at a time means a record written by an older build
 *  (a queued proposal holding a ticket in the old shape, say) no longer
 *  decodes — and a whole-file decode would then throw the file away, rooms,
 *  projects and adopted sessions with it. So the file is salvaged instead:
 *  every part that still reads is kept, the parts that do not are dropped and
 *  named, and the salvaged state is written straight back. Local migration,
 *  same idea as the room log's `evict` — the bad record stops existing rather
 *  than being carried. */

export const emptyState: LocalState = { preferredAi: null, rooms: {} };

const decode = <A>(schema: Schema.Codec<A, any>, value: unknown): A | null =>
  Option.getOrNull(Schema.decodeUnknownOption(schema)(value));

const obj = (x: unknown): Record<string, unknown> | null =>
  typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : null;

/** Keep the entries of a record that still decode; count the rest. */
const salvageRecord = <A>(raw: unknown, schema: Schema.Codec<A, any>, drop: () => void): Record<string, A> | undefined => {
  const src = obj(raw);
  if (!src) return undefined;
  const out: Record<string, A> = {};
  for (const [k, v] of Object.entries(src)) {
    const one = decode(schema, v);
    if (one === null) drop();
    else out[k] = one;
  }
  return out;
};

export interface Salvaged {
  readonly state: LocalState;
  /** What was thrown away, in words for the log. Empty when the file was whole. */
  readonly dropped: ReadonlyArray<string>;
}

export const salvageState = (text: string): Salvaged => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { state: emptyState, dropped: ["the state file is not readable JSON — starting fresh"] };
  }
  const whole = decode(LocalState, raw);
  if (whole !== null) return { state: whole, dropped: [] };

  const src = obj(raw);
  if (!src) return { state: emptyState, dropped: ["the state file is not a state file — starting fresh"] };
  const dropped: string[] = [];
  const count = (what: string) => {
    let n = 0;
    return {
      hit: () => n++,
      done: () => {
        if (n > 0) dropped.push(`${n} ${what}${n === 1 ? "" : "s"}`);
      },
    };
  };

  const projects = count("shared project");
  const rooms: Record<string, ReadonlyArray<Project>> = {};
  for (const [roomId, list] of Object.entries(obj(src.rooms) ?? {})) {
    rooms[roomId] = (Array.isArray(list) ? list : []).flatMap((p) => {
      const one = decode(Project, p);
      if (one === null) {
        projects.hit();
        return [];
      }
      return [one];
    });
  }
  projects.done();

  const threadDrops = count("adopted thread");
  const threads = salvageRecord(src.threads, AdoptedThread, threadDrops.hit);
  threadDrops.done();

  const consumedDrops = count("read cursor");
  const consumed = salvageRecord(src.consumed, Schema.Record(Schema.String, Schema.Finite), consumedDrops.hit);
  consumedDrops.done();

  const fileDrops = count("attached file");
  const attachedFiles = salvageRecord(src.attachedFiles, Schema.String, fileDrops.hit);
  fileDrops.done();

  const proposalDrops = count("sent record");
  const sent = Array.isArray(src.sent)
    ? src.sent.flatMap((p) => {
        const one = decode(Proposal, p);
        if (one === null) {
          proposalDrops.hit();
          return [];
        }
        return [one];
      })
    : undefined;
  proposalDrops.done();

  const askDrops = count("transcript request");
  const transcriptAsks = Array.isArray(src.transcriptAsks)
    ? src.transcriptAsks.flatMap((a) => {
        const one = decode(TranscriptAsk, a);
        if (one === null) {
          askDrops.hit();
          return [];
        }
        return [one];
      })
    : undefined;
  askDrops.done();

  const preferredAi = typeof src.preferredAi === "string" ? src.preferredAi : null;
  if (src.preferredAi !== null && typeof src.preferredAi !== "string" && src.preferredAi !== undefined) dropped.push("an unreadable ai setting");

  return {
    state: {
      preferredAi,
      rooms,
      ...(threads ? { threads } : {}),
      ...(consumed ? { consumed } : {}),
      ...(attachedFiles ? { attachedFiles } : {}),
      ...(sent ? { sent } : {}),
      ...(transcriptAsks ? { transcriptAsks } : {}),
    },
    dropped: dropped.length > 0 ? dropped : ["parts of the state file no longer readable"],
  };
};
