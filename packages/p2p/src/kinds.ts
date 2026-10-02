import type { TicketKind } from "./ticket";

/** What each kind of ticket is for, in one place: the person reads these
 *  lines in the TUI (the ? panel, the ticket page's header), the agent reads
 *  its own in the tool descriptions, and the tickets guide's "kinds at a
 *  glance" table carries the person's lines word for word (a test holds it
 *  to that). Two copies drift; one table cannot.
 *
 *  A Record over TicketKind on purpose: a kind added to the schema without a
 *  row here does not compile, so it can never be missing from the help.
 *
 *  Two registers, one source. The person's lines say what the thing is for;
 *  the agent's line says what to do with it. */
export interface KindInfo {
  /** What a ticket of this kind is — for the person. */
  readonly what: string;
  /** What it asks of a reader. */
  readonly asks: string;
  /** Who closes it, and when. */
  readonly closes: string;
  /** The same, for an agent: which tools, and that the person decides. */
  readonly agent: string;
}

export const KINDS: Record<TicketKind, KindInfo> = {
  epic: {
    what: "a folder of tickets that together make one body of work",
    asks: "nothing of its own — its parts ask; anyone may add, move or take them out",
    closes: "anyone — once everything in it is resolved; reopened with a reason",
    agent: "a folder of tickets, shared by the room: only when your user asks, the epic tool adds, removes, excludes or orders its tickets and closes it (once everything in it is resolved) or reopens it with a reason; when a filing outcome says so, offer an epic in one line",
  },
  proposal: {
    what: "an idea, written down; owed to no one",
    asks: "is it worth doing — and would you do it, or should I",
    closes: "its author — when a plan grew out of it, or it was dropped",
    agent: "an idea owed to no one: your user's take goes on it with post-review; accepting assigns nothing — a plan filed with from this ticket (ask-plan) is what binds anyone",
  },
  plan: {
    what: "something its author intends to do, and how",
    asks: "do you agree, what would you change, what am I missing",
    closes: "its author — having folded the takes in and decided",
    agent: "an intention put up for judgment: your user's blind first take goes on it with post-review, and only then does review-context open the author's thoughts",
  },
  bug: {
    what: "a symptom, with its reporter's reading of cause, importance and fix",
    asks: "what do you make of the symptom — your diagnosis before theirs",
    closes: "its reporter — fixed, planned, or let be",
    agent: "a symptom: your user's own diagnosis first, posted with post-review; review-context then opens the reporter's cause, importance, suggestion and remedy",
  },
  review: {
    what: "code that exists, with the why behind it",
    asks: "read the change against its reasons; approve it, or ask for changes",
    closes: "its author — once they have acted on the reviews",
    agent: "code under review, with its why: your user's review goes on it with post-review; review-context reads the why when they ask",
  },
  task: {
    what: "agreed work: a goal, and steps with an owner each",
    asks: "do your step, and settle it when it is done",
    closes: "its author — when the work is over",
    agent: "agreed work with owners: settle-step settles a step your user owns, when they say so — nobody else's",
  },
};

/** The kinds in the order work moves through them: the body of work that
 *  holds it all, an idea, how it gets done, what broke, the check on the
 *  work, then plain agreed work. The help lists them this way, so reading
 *  down is reading the pipeline. */
export const KIND_ORDER: ReadonlyArray<TicketKind> = (["epic", "proposal", "plan", "bug", "review", "task"] as const satisfies ReadonlyArray<TicketKind>);

/** Every kind's agent line, one per row — for a tool description. */
export const kindsForAgents = (): string => KIND_ORDER.map((k) => `${k}: ${KINDS[k].agent}`).join("; ");
