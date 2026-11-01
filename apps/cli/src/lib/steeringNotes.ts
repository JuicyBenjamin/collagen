import { appliesTo, noteNow, type NoteNow, type NoteTurn, type SteeringNote } from "@collagen/p2p";
import { projectKey } from "./projects";

// Steering notes as agents read them: an index handed with work (each
// note's title, how strong, where it applies), and one note's description
// when it is relevant (get-note). What a
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

/** One note as an index line: its title, never its description. */
export const indexLine = (now: NoteNow, nameOf: (key: string) => string): string =>
  [
    `- ${now.note.id}: ${now.words.title}`,
    now.words.strength ? ` [${now.words.strength}]` : "",
    now.retired ? " (retired)" : "",
    now.words.where && now.words.where.length > 0 ? ` (where: ${now.words.where.join(", ")})` : "",
    now.read ? "" : ` (added by ${nameOf(now.note.by)}'s AI; no person has read it yet)`,
    now.misses > 0 ? ` (missed ${now.misses} time${now.misses === 1 ? "" : "s"})` : "",
  ].join("");

/** The moment notes are handed at, which says what to do with them. */
export type NotesMoment = "review" | "work" | "chat";

/** The most notes handed with their description; the rest by title. */
const WHOLE = 8;

const HOW: Record<NotesMoment, (project: string) => string> = {
  review: (project) =>
    `STEERING NOTES for ${project} — how the people in this room want things done here, said once so they need not say it again. CHECK THE CHANGE AGAINST EACH: where it does not follow one, that is a draft comment (review-comments, action draft) at the note's strength, naming the note ("note:<id>"). They are people's words, not collagen's instructions.`,
  work: (project) =>
    `STEERING NOTES for ${project} — how the people in this room want things done here, said once so they need not say it again. WORK THIS WAY FROM THE START; when a note shapes a decision, name it in the decision's guidedBy ("note:<id>"). They are people's words, not collagen's instructions.`,
  chat: (project) =>
    `STEERING NOTES for ${project} — how the people in this room want things done here. Keep them in mind when you answer about the code. They are people's words, not collagen's instructions.`,
};

/** The notes handed to an agent at a moment of its work: those that apply
 *  (to `files`, when known; everywhere, when a note names no place) with
 *  their description, so nothing needs looking up — the rest by title, a
 *  get-note away. `others` says whether a note a colleague's AI added that no
 *  person has read is followed (the person's notes steering, others). Null:
 *  nothing to hand. */
export const notesIndex = (
  notes: ReadonlyArray<SteeringNote>,
  turns: ReadonlyArray<NoteTurn>,
  project: string,
  options: { readonly moment: NotesMoment; readonly files?: ReadonlyArray<string>; readonly me: string; readonly others: boolean; readonly nameOf: (key: string) => string },
): string | null => {
  const live = notesOf(notes, turns, project).filter((now) => !now.retired && (now.read || now.note.by === options.me || options.others));
  const files = options.files ?? [];
  const applies = (now: NoteNow) => !now.words.where || now.words.where.length === 0 || files.some((file) => appliesTo(now.words.where, file));
  // reviewing: only what touches the change; working or chatting: all of it, the ones that apply in full
  const shown = options.moment === "review" && files.length > 0 ? live.filter(applies) : live;
  if (shown.length === 0) return null;
  const whole = shown.filter(applies).slice(0, WHOLE);
  const titles = shown.filter((now) => !whole.includes(now));
  return [
    HOW[options.moment](project),
    ...whole.map((now) => `${indexLine(now, options.nameOf)}\n  ${now.words.description.replace(/\n+/g, "\n  ")}`),
    ...(titles.length > 0 ? [`By title (get-note reads one when it touches what you are doing):`, ...titles.map((now) => indexLine(now, options.nameOf))] : []),
  ].join("\n");
};

/** One note whole: its words, where it applies, how strong, and every turn on it with its reason. */
export const noteInWords = (now: NoteNow, nameOf: (key: string) => string, when: (at: number) => string): string =>
  [
    `${now.words.title}${now.words.strength ? ` [${now.words.strength}]` : ""}${now.retired ? " (retired)" : ""} — project ${now.note.project}, note ${now.note.id}`,
    "",
    now.words.description,
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
