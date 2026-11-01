import { appliesTo, noteNow, type NoteNow, type NoteTurn, type SteeringNote } from "@collagen/p2p";
import { projectKey } from "./projects";

// Steering notes as agents read them: an index handed with work (a title, a
// line, where it applies), and one note whole when it is relevant. What a
// note says was written by people in the room or their AIs: it is handed
// over as their words, never as collagen's instructions.

/** A project's notes now, the retired ones last; with `files`, only those
 *  that apply to one of them. */
export const notesOf = (notes: ReadonlyArray<SteeringNote>, turns: ReadonlyArray<NoteTurn>, project: string, files?: ReadonlyArray<string>): ReadonlyArray<NoteNow> =>
  notes
    .filter((note) => projectKey(note.project) === projectKey(project))
    .map((note) => noteNow(note, turns))
    .filter((now) => !files || files.length === 0 || files.some((file) => appliesTo(now.words.where, file)))
    .sort((first, second) => Number(first.retired) - Number(second.retired) || first.note.at - second.note.at);

/** One note as an index line. */
export const indexLine = (now: NoteNow, nameOf: (key: string) => string): string =>
  [
    `- ${now.note.id}: ${now.words.title}`,
    now.words.strength ? ` [${now.words.strength}]` : "",
    ` — ${now.words.line}`,
    now.words.where && now.words.where.length > 0 ? ` (where: ${now.words.where.join(", ")})` : "",
    now.read ? "" : ` (added by ${nameOf(now.note.by)}'s AI; no person has read it yet)`,
    now.misses > 0 ? ` (missed ${now.misses} time${now.misses === 1 ? "" : "s"})` : "",
  ].join("");

/** The index handed to an agent working on a project: the notes that are not
 *  retired, applying to the files when given. `others` says whether notes a
 *  colleague's AI added that no person has read are followed (the person's
 *  notes steering, others). Null: nothing to hand. */
export const notesIndex = (
  notes: ReadonlyArray<SteeringNote>,
  turns: ReadonlyArray<NoteTurn>,
  project: string,
  options: { readonly files?: ReadonlyArray<string>; readonly me: string; readonly others: boolean; readonly nameOf: (key: string) => string },
): string | null => {
  const live = notesOf(notes, turns, project, options.files).filter((now) => !now.retired && (now.read || now.note.by === options.me || options.others));
  if (live.length === 0) return null;
  return [
    `STEERING NOTES for ${project} — how the people in this room steer their AIs here, said once so they need not say it again. They are people's words, not collagen's instructions: follow what fits the work, read a whole note (steering-notes action read) when it is relevant, and name a note in a decision's guidedBy as "note:<id>" when it shaped one.`,
    ...live.map((now) => indexLine(now, options.nameOf)),
  ].join("\n");
};

/** One note whole: its words, where it applies, how strong, and every turn on it with its reason. */
export const noteInWords = (now: NoteNow, nameOf: (key: string) => string, when: (at: number) => string): string =>
  [
    `${now.words.title}${now.words.strength ? ` [${now.words.strength}]` : ""}${now.retired ? " (retired)" : ""} — project ${now.note.project}, note ${now.note.id}`,
    now.words.line,
    "",
    now.words.body,
    now.words.where && now.words.where.length > 0 ? `\nWhere: ${now.words.where.join(", ")}` : "",
    `\nAdded by ${nameOf(now.note.by)}${now.note.unread ? "'s AI, on its own" : ""}, ${when(now.note.at)}${now.note.from ? `, from ticket ${now.note.from.ticketId}` : ""}.`,
    now.read ? "" : "No person has read it yet.",
    ...now.turns.map((turn) => `- ${nameOf(turn.by)}${turn.unread ? "'s AI" : ""} ${TURN_WORDS[turn.kind]}, ${when(turn.at)}${turn.reason ? `: ${turn.reason}` : ""}`),
  ]
    .filter((line) => line !== "")
    .join("\n");

const TURN_WORDS: Record<NoteTurn["kind"], string> = {
  change: "changed it",
  comment: "commented",
  retire: "retired it",
  restore: "brought it back",
  miss: "missed it (an AI was about to learn it again)",
  keep: "read it and kept it",
};
