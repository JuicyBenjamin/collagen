import type { ReviewMachine } from "@collagen/p2p";

// A question about a review, as the author's collagen holds it (cli
// ReviewQuestions): one state at a time, and only the moves this table has.
// An event a state has no move for is refused, never taken somewhere the
// table does not say. The review page draws the same table (its machine).

export type QuestionState = "new" | "waiting" | "asking" | "answering" | "answered" | "declined" | "addressing";

/** What moves a question. */
export type QuestionEvent =
  /** it arrived, and the author's answering steering is not chosen, or never */
  | "held"
  /** it arrived, and their steering is ask first */
  | "asked"
  /** it arrived, and their steering lets their AI answer (act, just do it) */
  | "allowed"
  /** their yes */
  | "yes"
  /** nothing to answer from: no conversation of theirs did the work, or none is readable */
  | "unreadable"
  /** the answering job ended without answering */
  | "ended"
  /** answered: by the job, by them, or a guess at it confirmed */
  | "answered"
  /** answered, and it found a flaw their work steering hands to the conversation that built the work */
  | "fixing"
  /** their no */
  | "declined";

export interface QuestionMove {
  readonly from: ReadonlyArray<QuestionState>;
  readonly on: QuestionEvent;
  readonly to: QuestionState;
  /** what takes it, as a reader reads it */
  readonly says: string;
}

/** Still open: the author may yet answer it. */
const OPEN: ReadonlyArray<QuestionState> = ["waiting", "asking", "answering"];

export const QUESTION_MOVES: ReadonlyArray<QuestionMove> = [
  { from: ["new"], on: "held", to: "waiting", says: "it arrives, and the author's answering steering is not chosen, or never" },
  { from: ["new"], on: "asked", to: "asking", says: "it arrives, and their steering is ask first" },
  { from: ["new"], on: "allowed", to: "answering", says: "it arrives, and their steering lets their AI answer" },
  { from: ["waiting", "asking"], on: "yes", to: "answering", says: "their yes" },
  { from: ["new", ...OPEN], on: "unreadable", to: "waiting", says: "no conversation of theirs holds the work, or none is readable" },
  { from: ["answering"], on: "ended", to: "waiting", says: "the answering job ends without answering" },
  { from: OPEN, on: "answered", to: "answered", says: "answered: by their AI or by them, or a guess at it confirmed" },
  { from: OPEN, on: "fixing", to: "addressing", says: "answered, and its flaw is handed to the conversation that built the work" },
  { from: OPEN, on: "declined", to: "declined", says: "their no" },
];

/** Where an event takes a question, or null: the table has no such move. */
export const nextQuestion = (state: QuestionState, on: QuestionEvent): QuestionState | null =>
  QUESTION_MOVES.find((move) => move.on === on && move.from.includes(state))?.to ?? null;

const STATES: ReadonlyArray<{ readonly id: QuestionState; readonly name: string; readonly shows: string }> = [
  { id: "new", name: "Arrived", shows: "the question is on the author's machine, not looked at yet" },
  { id: "waiting", name: "Waiting", shows: "the asker reads why it waits, and may have their AI assume the reason instead" },
  { id: "asking", name: "Asking", shows: "the author's agent asks them whether their AI may answer" },
  { id: "answering", name: "Answering", shows: "a job reads a copy of the conversation the work was done in" },
  { id: "answered", name: "Answered", shows: "the answer is in the asker's chat and on the review's why" },
  { id: "declined", name: "Declined", shows: "the asker reads that the author declined, and may have their AI assume the reason" },
  { id: "addressing", name: "Being fixed", shows: "the conversation that built the work fixes what the answer found wrong" },
];

/** The table as a review's machine: its states, every move, and one walk-through. */
export const questionMachine = (): ReviewMachine => ({
  title: "A question about a review",
  summary: "A question the review's why does not answer, as the author's collagen holds it: one state at a time, and only these moves; anything else is refused.",
  sources: [
    { id: "asker", name: "The asker", gives: "the question, from their chat on the review page (ask-author)" },
    { id: "steering", name: "The author's steering", gives: "whether their AI answers on its own, asks them, or waits" },
    { id: "author", name: "The author", gives: "their yes or no (review-question)" },
    { id: "job", name: "The answering job", gives: "the answer, and any flaw it found" },
  ],
  actors: [{ id: "question", name: "A question", starts: "new" }],
  now: {
    states: STATES.map((state) => ({ ...state })),
    moves: QUESTION_MOVES.flatMap((move) => move.from.map((from) => ({ from, to: move.to, on: move.says }))),
    play: [
      { from: "steering", moves: [{ actor: "question", to: "asking" }], says: "A colleague's question arrives; the author's steering is ask first, so their agent asks them." },
      { from: "author", moves: [{ actor: "question", to: "answering" }], says: "They say yes: a job reads the conversation the work was done in." },
      { from: "job", moves: [{ actor: "question", to: "addressing" }], says: "The answer goes to the asker and onto the why; it found a flaw, and their work steering hands it to the conversation that built the work." },
    ],
  },
});
