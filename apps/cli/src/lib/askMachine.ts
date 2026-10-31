import type { ReviewMachine } from "@collagen/p2p";

// A review asked of the person's work that has no ticket yet, as their
// collagen holds it (cli ReviewRequests): one state at a time, and only the
// moves this table has. An event a state has no move for is refused, never
// taken somewhere the table does not say. Review asks' review draws it.

export type AskState = "new" | "waiting" | "asking" | "filing" | "filed" | "declined" | "unsure";

/** What moves an ask. */
export type AskEvent =
  /** it arrived, and the author's steering for review asks is not chosen, or never */
  | "held"
  /** it arrived, and their steering is ask first */
  | "asked"
  /** it arrived, and their steering lets their AI file it (act, just do it) */
  | "allowed"
  /** their yes — or, after unsure, the conversation they picked */
  | "yes"
  /** nothing to file from: no shared project, no branch, no conversation of theirs did the work, or none is readable */
  | "unreadable"
  /** the filing job ended without filing, or could not be queued */
  | "ended"
  /** the filing job could not tell which conversation holds the why */
  | "unsure"
  /** the review ticket is filed: by the job, or from the conversation that did the work */
  | "filed"
  /** their no */
  | "declined";

export interface AskMove {
  readonly from: ReadonlyArray<AskState>;
  readonly on: AskEvent;
  readonly to: AskState;
  /** what takes it, as a reader reads it */
  readonly says: string;
}

/** Still open: it may yet be filed. */
const OPEN: ReadonlyArray<AskState> = ["waiting", "asking", "filing", "unsure"];

export const ASK_MOVES: ReadonlyArray<AskMove> = [
  { from: ["new"], on: "held", to: "waiting", says: "it arrives, and the author's steering for review asks is not chosen, or never" },
  { from: ["new"], on: "asked", to: "asking", says: "it arrives, and their steering is ask first" },
  { from: ["new"], on: "allowed", to: "filing", says: "it arrives, and their steering lets their AI file it" },
  { from: ["waiting", "asking", "unsure"], on: "yes", to: "filing", says: "their yes, or the conversation they picked" },
  { from: ["new", ...OPEN], on: "unreadable", to: "waiting", says: "nothing to file from: no shared project, no branch, or no readable conversation did the work" },
  { from: ["filing"], on: "ended", to: "waiting", says: "the filing job ends without filing" },
  { from: ["filing"], on: "unsure", to: "unsure", says: "the job cannot tell which conversation holds the why" },
  { from: ["new", ...OPEN], on: "filed", to: "filed", says: "the review ticket is filed, by the job or from the conversation that did the work" },
  { from: OPEN, on: "declined", to: "declined", says: "their no" },
];

/** Where an event takes an ask, or null: the table has no such move. */
export const nextAsk = (state: AskState, on: AskEvent): AskState | null => ASK_MOVES.find((move) => move.on === on && move.from.includes(state))?.to ?? null;

const STATES: ReadonlyArray<{ readonly id: AskState; readonly name: string; readonly shows: string }> = [
  { id: "new", name: "Arrived", shows: "the ask is on the author's machine, not looked at yet" },
  { id: "waiting", name: "Waiting", shows: "the asker reads that it waits on the author, and why" },
  { id: "asking", name: "Asking", shows: "the author's agent asks them whether to file it" },
  { id: "filing", name: "Filing", shows: "a job reads a copy of the conversation the work was done in, and files the review ticket" },
  { id: "unsure", name: "Unsure", shows: "the author is asked which conversation holds the work" },
  { id: "filed", name: "Filed", shows: "the review ticket is in the room; the asker's review starts on it" },
  { id: "declined", name: "Declined", shows: "the asker reads that the author declined" },
];

/** The table as a review's machine: its states, every move, and one walk-through. */
export const askMachine = (): ReviewMachine => ({
  title: "A review asked for without a ticket",
  summary: "A review asked of someone's work that has no ticket yet, as the author's collagen holds it: one state at a time, and only these moves; anything else is refused.",
  sources: [
    { id: "asker", name: "The asker", gives: "the ask, naming the branch or pull request (request-review)" },
    { id: "steering", name: "The author's steering", gives: "whether their AI files it on its own, asks them, or waits" },
    { id: "author", name: "The author", gives: "their yes or no, or which conversation holds the work (review-request)" },
    { id: "job", name: "The filing job", gives: "the review ticket, or that it cannot tell which conversation it is" },
  ],
  actors: [{ id: "ask", name: "An ask", starts: "new" }],
  now: {
    states: STATES.map((state) => ({ ...state })),
    moves: ASK_MOVES.flatMap((move) => move.from.map((from) => ({ from, to: move.to, on: move.says }))),
    play: [
      { from: "steering", moves: [{ actor: "ask", to: "filing" }], says: "A colleague asks for a review of a branch with no ticket; the author's steering lets their AI file it." },
      { from: "job", moves: [{ actor: "ask", to: "unsure" }], says: "Two conversations worked on the branch, and they disagree on why: the author is asked which one." },
      { from: "author", moves: [{ actor: "ask", to: "filing" }], says: "They pick one: the job files the review from it." },
      { from: "job", moves: [{ actor: "ask", to: "filed" }], says: "The review ticket is filed in their name, and the asker's review starts on it." },
    ],
  },
});
