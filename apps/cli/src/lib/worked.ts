import { Schema } from "effect";
import { conversationKey, Harness, type Conversation, type LocalState, type Outgoing, type Worked } from "@collagen/p2p";

const isHarness = Schema.is(Harness);

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

/** What a conversation did or said that is remembered: what it worked on,
 *  where it can be reached, a ticket it wants to hear about or no longer. */
export interface Noted {
  readonly threads?: ReadonlyArray<string>;
  readonly tickets?: ReadonlyArray<string>;
  readonly socket?: string;
  readonly watch?: { readonly ticket: string; readonly on: boolean };
}

/** State with `conversation` forgotten: a job's own run, over once it ends,
 *  is never a conversation to hear news. */
export const withoutWorked = (state: LocalState, conversation: Conversation): LocalState => {
  const key = conversationKey(conversation);
  if (!state.worked?.[key]) return state;
  const { [key]: _gone, ...rest } = state.worked;
  return { ...state, worked: rest };
};

/** State with `conversation` remembered as `noted` at `now`. */
export const withWorked = (state: LocalState, conversation: Conversation, noted: Noted, now: number): LocalState => {
  const threads = noted.threads ?? [];
  const tickets = noted.tickets ?? [];
  if (threads.length === 0 && tickets.length === 0 && noted.socket === undefined && noted.watch === undefined) return state;
  const key = conversationKey(conversation);
  const had = state.worked?.[key];
  const socket = noted.socket ?? had?.socket;
  const watching = noted.watch
    ? noted.watch.on
      ? added(had?.watching ?? [], [noted.watch.ticket])
      : (had?.watching ?? []).filter((ticket) => ticket !== noted.watch!.ticket)
    : had?.watching;
  const worked: Worked = {
    conversation,
    threads: added(had?.threads ?? [], threads),
    tickets: added(had?.tickets ?? [], tickets),
    last: now,
    ...(socket ? { socket } : {}),
    ...(watching && watching.length > 0 ? { watching } : {}),
  };
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

/** Why a conversation hears a message: its person adopted the thread or
 *  said yes to watching the ticket (their yes to this one), or it worked on
 *  it (heard only where their delivery steering does not ask first). */
export type Heard = "adopted" | "watching" | "worked";

/** The one conversation a message goes to, if any — never two, so nothing is
 *  woken twice: the thread's adopter, else the latest watching its ticket,
 *  else the latest that worked on its ticket or thread. */
export const listenerFor = (
  state: Pick<LocalState, "threads" | "worked">,
  message: { readonly threadId: string; readonly ticketId?: string | undefined; readonly conversation?: Conversation | undefined },
): { readonly conversation: Conversation; readonly heard: Heard; readonly socket?: string } | undefined => {
  // the conversation that did what the message tells is never woken by it
  const actor = message.conversation ? conversationKey(message.conversation) : undefined;
  const all = Object.values(state.worked ?? {})
    .filter((worked) => conversationKey(worked.conversation) !== actor)
    .sort((first, second) => second.last - first.last);
  const reach = (conversation: Conversation, heard: Heard) => {
    const socket = state.worked?.[conversationKey(conversation)]?.socket;
    return { conversation, heard, ...(socket ? { socket } : {}) };
  };
  const adopted = state.threads?.[message.threadId];
  if (adopted && isHarness(adopted.ai) && conversationKey({ ai: adopted.ai, id: adopted.sessionId }) !== actor) return reach({ ai: adopted.ai, id: adopted.sessionId }, "adopted");
  const ticketId = message.ticketId;
  const watching = ticketId ? all.find((worked) => worked.watching?.includes(ticketId)) : undefined;
  if (watching) return reach(watching.conversation, "watching");
  const worked = all.find((one) => (ticketId !== undefined && one.tickets.includes(ticketId)) || one.threads.includes(message.threadId));
  return worked ? reach(worked.conversation, "worked") : undefined;
};
