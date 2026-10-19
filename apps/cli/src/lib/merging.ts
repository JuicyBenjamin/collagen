import { closedAs, isTake, type LocalState, type MergeFor, type Ticket, type TicketStep } from "@collagen/p2p";

// Merging a review's pull request for its author: whose approval collagen
// waits for (MergeFor), in three layers — a review's own, its room's, and
// the default a room is given when it is joined — and whether one is ready.
// Collagen only ever merges as its person, through their own host tool: the
// host's own rules (an approval it requires, checks) always come first.

export const MERGE_LEVELS: ReadonlyArray<MergeFor> = ["off", "theirs", "mine", "both"];

/** What each level means, for the person and the agent alike. */
export const MERGE_HELP: Record<MergeFor, string> = {
  off: "never: you merge it yourself",
  theirs: "when someone else approves it",
  mine: "when you accept it on its page",
  both: "when someone else approves it and you accept it",
};

/** Whose approval a review waits for: its own, else its room's, else the default. */
export const mergeForOf = (state: Pick<LocalState, "merging">, roomId: string, ticketId: string): MergeFor =>
  state.merging?.tickets?.[ticketId] ?? state.merging?.rooms?.[roomId] ?? state.merging?.default ?? "off";

/** Where a level is set: for every room joined from now on, for one room, or for one review. */
export type MergeScope = { readonly default: true } | { readonly room: string } | { readonly ticket: string };

/** The state with one layer set — or, for a room or a review, given back to
 *  the layer above it (null). */
export const withMergeFor = <S extends Pick<LocalState, "merging">>(state: S, scope: MergeScope, level: MergeFor | null): S => {
  const merging = state.merging ?? {};
  const setIn = (record: Readonly<Record<string, MergeFor>> | undefined, key: string) => {
    const { [key]: _was, ...rest } = record ?? {};
    return level === null ? rest : { ...rest, [key]: level };
  };
  if ("default" in scope) return { ...state, merging: { ...merging, ...(level === null ? {} : { default: level }) } };
  if ("room" in scope) return { ...state, merging: { ...merging, rooms: setIn(merging.rooms, scope.room) } };
  return { ...state, merging: { ...merging, tickets: setIn(merging.tickets, scope.ticket) } };
};

/** A room just joined takes the default, so changing the default later
 *  leaves the rooms already set as they are. */
export const joinedRoom = <S extends Pick<LocalState, "merging">>(state: S, roomId: string): S =>
  state.merging?.default === undefined || state.merging.rooms?.[roomId] !== undefined ? state : withMergeFor(state, { room: roomId }, state.merging.default);

/** A pull request as its host has it, for merging: host-neutral. */
export interface HostReadiness {
  readonly state: "open" | "closed" | "merged";
  readonly draft: boolean;
  readonly checks: "passing" | "pending" | "failing" | "none";
  /** the branch cannot go in as it is; null while the host is still working it out */
  readonly conflicts: boolean | null;
  /** the host's own rules want an approval it has not had */
  readonly approvalRequired: boolean;
  readonly changesRequested: boolean;
}

/** Ready to merge, waiting (and on what), or not for collagen to merge. */
export type Readiness = { readonly merge: true } | { readonly waiting: string } | { readonly never: string };

/** Whether the room's side of a review lets it be merged for its author at
 *  `level`: approved as the level asks, every reviewer named having
 *  answered, and no take asking for changes. A take that only comments
 *  answers, but approves nothing. */
export const ticketReadiness = (ticket: Ticket, me: string, level: MergeFor, nameOf: (key: string) => string): Readiness => {
  if (level === "off") return { never: "merging for you is off" };
  if (ticket.kind !== "review") return { never: "only a review's pull request is merged" };
  if (ticket.createdBy !== me) return { never: "only its author's collagen merges it" };
  if (closedAs(ticket) !== null) return { never: "the review is closed" };
  const takes = ticket.steps.filter(isTake);
  const asking = takes.find((step) => step.status === "failed");
  if (asking) return { waiting: `${nameOf(asking.owner)} asked for changes` };
  const others = takes.filter((step) => step.owner !== me);
  const unanswered = others.find((step) => step.status === "pending" || step.status === "suspended");
  if (unanswered) return { waiting: `waiting on ${nameOf(unanswered.owner)}'s review` };
  const approves = (step: TicketStep) => step.status === "settled" && !step.comment;
  const theirs = others.some(approves);
  const mine = takes.some((step) => step.owner === me && approves(step));
  if ((level === "theirs" || level === "both") && !theirs) return { waiting: "waiting for someone else to approve it" };
  if ((level === "mine" || level === "both") && !mine) return { waiting: "waiting for you to accept it" };
  return { merge: true };
};

/** Whether the host lets it be merged now: its own rules first. */
export const hostReadiness = (pull: HostReadiness, host: string): Readiness => {
  if (pull.state === "merged") return { never: "it is merged already" };
  if (pull.state === "closed") return { never: `its pull request is closed on ${host}` };
  if (pull.draft) return { waiting: "its pull request is a draft" };
  if (pull.changesRequested) return { waiting: `changes are requested on ${host}` };
  if (pull.approvalRequired) return { waiting: `${host}'s rules for this repository want an approval it has not had` };
  if (pull.checks === "failing") return { waiting: "its checks are failing" };
  if (pull.checks === "pending") return { waiting: "its checks are still running" };
  if (pull.conflicts === true) return { waiting: "it conflicts with its base" };
  if (pull.conflicts === null) return { waiting: `${host} is still working out whether it merges cleanly` };
  return { merge: true };
};
