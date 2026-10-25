import { conversationKey, type Conversation, type LocalState, type Outgoing, type Worked } from "@collagen/p2p";

// What each of the person's AI conversations has worked on here: the threads
// it wrote on and the tickets it acted on. Remembered as it acts, kept on this
// machine, and read by whatever needs to know which conversation holds what —
// never a reason, by itself, to deliver anything to one (adoption is that).

/** How many conversations are remembered, and how much of each. */
const CONVERSATIONS = 50;
const EACH = 200;

/** The tickets an act is on, by what it writes. */
export const ticketsOf = (out: Outgoing): ReadonlyArray<string> => {
  switch (out.kind) {
    case "message":
      return out.ticketId ? [out.ticketId] : [];
    case "ticket":
      return [out.ticket.id];
    case "review":
      return [out.review.ticketId];
    case "post-review":
    case "settle":
    case "take":
    case "close":
    case "attach":
      return [out.ticketId];
    case "epic-move":
      return out.epic ? [...out.ticketIds, out.epic] : out.ticketIds;
    case "epic-order":
      return [out.epicId, ...out.ticketIds];
    case "epic-turn":
      return [out.epicId];
    case "transcript":
      return [];
  }
};

/** `known` with `fresh` added at the end, each once, the latest kept. */
const added = (known: ReadonlyArray<string>, fresh: ReadonlyArray<string>): ReadonlyArray<string> =>
  [...known.filter((id) => !fresh.includes(id)), ...fresh].slice(-EACH);

/** State with `conversation` remembered to have worked on `on` at `now`. */
export const withWorked = (state: LocalState, conversation: Conversation, on: { readonly threads: ReadonlyArray<string>; readonly tickets: ReadonlyArray<string> }, now: number): LocalState => {
  if (on.threads.length === 0 && on.tickets.length === 0) return state;
  const key = conversationKey(conversation);
  const had = state.worked?.[key];
  const worked: Worked = { conversation, threads: added(had?.threads ?? [], on.threads), tickets: added(had?.tickets ?? [], on.tickets), last: now };
  // the most recent conversations, the oldest let go
  const kept = Object.entries({ ...state.worked, [key]: worked })
    .sort(([, first], [, second]) => second.last - first.last)
    .slice(0, CONVERSATIONS);
  return { ...state, worked: Object.fromEntries(kept) };
};

/** The conversations that have worked on a thread or a ticket, the latest first. */
export const conversationsOn = (state: Pick<LocalState, "worked">, on: { readonly thread: string } | { readonly ticket: string }): ReadonlyArray<Conversation> =>
  Object.values(state.worked ?? {})
    .filter((worked) => ("thread" in on ? worked.threads.includes(on.thread) : worked.tickets.includes(on.ticket)))
    .sort((first, second) => second.last - first.last)
    .map((worked) => worked.conversation);
