import { Schema } from "effect";
import { Conversation } from "./acting";

// Steering notes: how the people in a room steer their AIs on a project —
// the corrections they keep having to make, said once and then followed.
// Each note is the room's, for one project (by name, as projects are
// matched), and stays alive like a skill: anyone may comment on it, change
// it with a reason, retire it or bring it back. Peers write turns on a note
// and every peer folds them in the same order (noteNow), whatever order the
// copies arrive in: the note and each turn are written once, by random id,
// and never changed.

/** How hard a note pushes: the strengths review comments already carry. */
export const NoteStrength = Schema.Literals(["nit", "suggest", "wish", "must"]);
export type NoteStrength = typeof NoteStrength.Type;

/** What a note says: a title, the one line an agent is handed, and the whole
 *  of it (reasoning, examples) read only when it is relevant. */
export const NoteWords = Schema.Struct({
  title: Schema.String,
  line: Schema.String,
  body: Schema.String,
  /** where it applies: paths or globs ("apps/review-web/**", "*.tsx"); none: the whole project */
  where: Schema.optional(Schema.Array(Schema.String)),
  strength: Schema.optional(NoteStrength),
});
export type NoteWords = typeof NoteWords.Type;

/** A change's new words: only what changed. */
export const NoteChange = Schema.Struct({
  title: Schema.optional(Schema.String),
  line: Schema.optional(Schema.String),
  body: Schema.optional(Schema.String),
  where: Schema.optional(Schema.Array(Schema.String)),
  strength: Schema.optional(NoteStrength),
});
export type NoteChange = typeof NoteChange.Type;

/** A note as first written. Written once, by its id; what changes it is turns. */
export const SteeringNote = Schema.Struct({
  id: Schema.String,
  /** the project's name, as the room shares it */
  project: Schema.String,
  ...NoteWords.fields,
  /** who added it (pubkey) and their name then */
  by: Schema.String,
  byName: Schema.String,
  at: Schema.Finite,
  /** added by an AI on its own, without its person's word: unread until a person takes it up */
  unread: Schema.optional(Schema.Boolean),
  /** what it grew from: a review, and the comment on it */
  from: Schema.optional(Schema.Struct({ ticketId: Schema.String, commentId: Schema.optional(Schema.String) })),
  agent: Schema.optional(Schema.String),
  conversation: Schema.optional(Conversation),
});
export type SteeringNote = typeof SteeringNote.Type;

/** What a turn does to a note. */
export const NoteTurnKind = Schema.Literals([
  /** its words changed, with a reason */
  "change",
  /** someone's view of it, with their reasons */
  "comment",
  /** taken out of what agents are handed, with a reason */
  "retire",
  /** brought back */
  "restore",
  /** it was not followed: an AI was about to learn it again */
  "miss",
  /** a person read it and keeps it as it is */
  "keep",
]);
export type NoteTurnKind = typeof NoteTurnKind.Type;

/** One act on a note. Written once, by a random id; `knows` is the turns on
 *  the note its writer had seen, so peers order them causally, not by clock. */
export const NoteTurn = Schema.Struct({
  id: Schema.String,
  note: Schema.String,
  kind: NoteTurnKind,
  /** the reason for a change, retire or restore; a comment's words; what was missed */
  reason: Schema.optional(Schema.String),
  /** a change's new words: only what changed */
  change: Schema.optional(NoteChange),
  knows: Schema.Array(Schema.String),
  by: Schema.String,
  byName: Schema.String,
  at: Schema.Finite,
  /** written by an AI on its own: a person has not read the note through it */
  unread: Schema.optional(Schema.Boolean),
  agent: Schema.optional(Schema.String),
  conversation: Schema.optional(Conversation),
});
export type NoteTurn = typeof NoteTurn.Type;

/** A note as it stands now: its words after every change, whether it is
 *  retired, what was said on it, and who has written to it. */
export interface NoteNow {
  readonly note: SteeringNote;
  readonly words: NoteWords;
  readonly retired: boolean;
  /** a person has read it: added on a person's word, or taken up by one since */
  readonly read: boolean;
  /** every turn on it, in the order every peer folds them */
  readonly turns: ReadonlyArray<NoteTurn>;
  readonly misses: number;
  /** everyone who added, changed or retired it — told when it changes */
  readonly writers: ReadonlyArray<string>;
}

/** A note's turns in one order on every peer: a turn after every turn its
 *  writer had seen (its depth), then by time, then by id — a total order over
 *  the whole turn, so the fold is the same however copies arrived. */
export const orderTurns = (turns: ReadonlyArray<NoteTurn>): ReadonlyArray<NoteTurn> => {
  const byId = new Map(turns.map((turn) => [turn.id, turn]));
  const depths = new Map<string, number>();
  const depthOf = (turn: NoteTurn, seen: ReadonlySet<string>): number => {
    const known = depths.get(turn.id);
    if (known !== undefined) return known;
    // a cycle can only come from a forged turn: it counts as knowing nothing
    const next = new Set(seen).add(turn.id);
    const depth = 1 + Math.max(0, ...turn.knows.flatMap((id) => (byId.has(id) && !next.has(id) ? [depthOf(byId.get(id)!, next)] : [])));
    depths.set(turn.id, depth);
    return depth;
  };
  return [...byId.values()].sort((first, second) => depthOf(first, new Set()) - depthOf(second, new Set()) || first.at - second.at || (first.id < second.id ? -1 : first.id > second.id ? 1 : 0));
};

/** A note folded with its turns (those for other notes are ignored). */
export const noteNow = (note: SteeringNote, turns: ReadonlyArray<NoteTurn>): NoteNow => {
  const ordered = orderTurns(turns.filter((turn) => turn.note === note.id));
  let words: NoteWords = { title: note.title, line: note.line, body: note.body, ...(note.where ? { where: note.where } : {}), ...(note.strength ? { strength: note.strength } : {}) };
  let retired = false;
  let read = note.unread !== true;
  const writers = new Set<string>([note.by]);
  for (const turn of ordered) {
    if (!turn.unread) read = true;
    if (turn.kind === "change" && turn.change) {
      words = { ...words, ...Object.fromEntries(Object.entries(turn.change).filter(([, value]) => value !== undefined)) };
      writers.add(turn.by);
    }
    if (turn.kind === "retire") {
      retired = true;
      writers.add(turn.by);
    }
    if (turn.kind === "restore") {
      retired = false;
      writers.add(turn.by);
    }
  }
  return { note, words, retired, read, turns: ordered, misses: ordered.filter((turn) => turn.kind === "miss").length, writers: [...writers] };
};

/** Does a note apply to a file: no `where`, or a path or glob that matches it. */
export const appliesTo = (where: ReadonlyArray<string> | undefined, file: string): boolean =>
  !where || where.length === 0 || where.some((pattern) => globMatch(pattern, file));

/** A glob as people write them: `**` any depth, `*` within one part, a bare
 *  name (no slash) matches that name anywhere, a path without wildcards its
 *  file or everything under it. */
const globMatch = (pattern: string, file: string): boolean => {
  const glob = pattern.trim().replace(/^\.\//, "");
  if (!glob) return false;
  if (!/[*?]/.test(glob)) return file === glob || file.startsWith(`${glob.replace(/\/$/, "")}/`) || (!glob.includes("/") && file.split("/").includes(glob));
  const body = glob
    .split(/(\*\*\/?|\*|\?)/)
    .map((part) => (part === "**/" || part === "**" ? ".*" : part === "*" ? "[^/]*" : part === "?" ? "[^/]" : part.replace(/[.+^${}()|[\]\\]/g, "\\$&")))
    .join("");
  return new RegExp(glob.includes("/") ? `^${body}$` : `(^|/)${body}$`).test(file);
};
