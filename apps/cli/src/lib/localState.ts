import { Option, Schema } from "effect";
import { AdoptedThread, DraftComment, LocalState, Merging, Project, Proposal, Settings, Steering, TranscriptAsk } from "@collagen/p2p";
import { checkedThemes } from "@collagen/review-web/themeData";

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

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/** Keep the entries of a record that still decode; count the rest. */
const salvageRecord = <A>(raw: unknown, schema: Schema.Codec<A, any>, drop: () => void): Record<string, A> | undefined => {
  const src = asRecord(raw);
  if (!src) return undefined;
  const out: Record<string, A> = {};
  for (const [key, value] of Object.entries(src)) {
    const one = decode(schema, value);
    if (one === null) drop();
    else out[key] = one;
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

  const src = asRecord(raw);
  if (!src) return { state: emptyState, dropped: ["the state file is not a state file — starting fresh"] };
  const dropped: string[] = [];
  const count = (what: string) => {
    let drops = 0;
    return {
      hit: () => drops++,
      done: () => {
        if (drops > 0) dropped.push(`${drops} ${what}${drops === 1 ? "" : "s"}`);
      },
    };
  };

  const projects = count("shared project");
  const rooms: Record<string, ReadonlyArray<Project>> = {};
  for (const [roomId, list] of Object.entries(asRecord(src.rooms) ?? {})) {
    rooms[roomId] = (Array.isArray(list) ? list : []).flatMap((project) => {
      const one = decode(Project, project);
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

  // the comments not said yet, per review: one unreadable takes only itself
  const draftDrops = count("unsaid review comment");
  const draftsRaw = asRecord(src.drafts);
  const drafts = draftsRaw
    ? Object.fromEntries(
        Object.entries(draftsRaw).flatMap(([ticket, list]) => {
          const kept = (Array.isArray(list) ? list : []).flatMap((draft) => {
            const one = decode(DraftComment, draft);
            if (one === null) draftDrops.hit();
            return one === null ? [] : [one];
          });
          return kept.length > 0 ? [[ticket, kept]] : [];
        }),
      )
    : undefined;
  draftDrops.done();

  // which assumed reviews of their code the agent was told of: plain ids, the bad ones dropped
  const toldGuessed = Array.isArray(src.toldGuessed) ? src.toldGuessed.filter((entry): entry is string => typeof entry === "string") : undefined;

  const finishDrops = count("finished review record");
  const finished = salvageRecord(src.finished, Schema.Array(Schema.String), finishDrops.hit);
  finishDrops.done();

  const proposalDrops = count("sent record");
  const sent = Array.isArray(src.sent)
    ? src.sent.flatMap((proposal) => {
        const one = decode(Proposal, proposal);
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
    ? src.transcriptAsks.flatMap((ask) => {
        const one = decode(TranscriptAsk, ask);
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

  // an unreadable level falls back to the asking end, the default
  const steering = decode(Steering, src.steering);
  if (src.steering !== undefined && steering === null) dropped.push("an unreadable steering setting (back to: ask first)");

  // unreadable switches go back to their defaults
  const settings = decode(Settings, src.settings);
  if (src.settings !== undefined && settings === null) dropped.push("unreadable settings (back to their defaults)");

  // unreadable, nothing is merged for them until it is set again
  const merging = decode(Merging, src.merging);
  if (src.merging !== undefined && merging === null) dropped.push("unreadable merge settings (back to: never)");

  // the page's themes, each checked as a pasted one is: what could not be shown is left out
  const themes = src.themes === undefined ? undefined : checkedThemes(src.themes);
  const savedGiven = typeof src.themes === "object" && src.themes !== null && Array.isArray((src.themes as { saved?: unknown }).saved) ? (src.themes as { saved: ReadonlyArray<unknown> }).saved.length : 0;
  if (themes && themes.saved.length < savedGiven) dropped.push("unreadable page themes");

  return {
    state: {
      preferredAi,
      ...(steering ? { steering } : {}),
      ...(settings ? { settings } : {}),
      ...(merging ? { merging } : {}),
      ...(themes ? { themes } : {}),
      rooms,
      ...(threads ? { threads } : {}),
      ...(consumed ? { consumed } : {}),
      ...(attachedFiles ? { attachedFiles } : {}),
      ...(sent ? { sent } : {}),
      ...(transcriptAsks ? { transcriptAsks } : {}),
      ...(drafts && Object.keys(drafts).length > 0 ? { drafts } : {}),
      ...(finished ? { finished } : {}),
      ...(toldGuessed && toldGuessed.length > 0 ? { toldGuessed } : {}),
    },
    dropped: dropped.length > 0 ? dropped : ["parts of the state file no longer readable"],
  };
};
