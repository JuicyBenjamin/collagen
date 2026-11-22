// How a room's connection stands, read once from everything collagen knows
// about it (services/Rooms gathers it): the facts room-connection gives an
// AI, and — when something stands in the way — the one thing wrong, in
// plain words, with what to try. The TUI shows that same line, so a person
// and their AI never read the room differently. Pure.

/** Everything known about one room's connection, at one moment. */
export interface RoomState {
  readonly now: number;
  readonly net: string;
  readonly protocol: string;
  /** null until the DHT has looked */
  readonly firewalled: boolean | null;
  readonly logOpen: boolean;
  readonly writable: boolean;
  /** we hold an invite to show a member: without one, and without the log, nobody is asked to let us in */
  readonly invited: boolean;
  /** our invite was heard and waits on someone allowed to let us in */
  readonly awaiting: boolean;
  /** why our invite was turned down, when it was */
  readonly refusal: string | null;
  /** members connected now, with the protocol each runs */
  readonly here: ReadonlyArray<{ readonly name: string; readonly protocol: string }>;
  /** members not connected now */
  readonly away: ReadonlyArray<string>;
  /** on the room's topic, not let in */
  readonly strangers: ReadonlyArray<string>;
  /** peers whose build speaks another protocol, so nothing of theirs is read: their short key and protocol */
  readonly otherProtocol: ReadonlyArray<{ readonly key: string; readonly protocol: string }>;
  readonly waiting: ReadonlyArray<{ readonly name: string; readonly at: number }>;
  /** everyone who wants in, with who they are: those waiting on a yes and those at the door with no invite */
  readonly waiters: ReadonlyArray<Waiter>;
  /** our role here may let them in */
  readonly mayLetIn: boolean;
  readonly declined: ReadonlyArray<{ readonly name: string; readonly reason?: string }>;
  readonly admitFailed: ReadonlyArray<{ readonly name: string; readonly why: string; readonly at: number }>;
  /** the swarm's connections, every room's */
  readonly open: number;
  readonly connecting: number;
}

/** What stands in the way, and what to try. */
export interface Trouble {
  readonly what: string;
  readonly next: string;
  /** the same in a few words, for beside the room's name */
  readonly brief: string;
}

/** Someone who wants into the room: they showed an invite and wait for a
 *  yes, or they are at the door with none. */
export interface Waiter {
  readonly key: string;
  readonly name: string;
  /** when their invite was heard; null at the door, with no invite */
  readonly at: number | null;
}

/** Everyone who wants in, those who asked first: the ones whose invite
 *  waits for a yes, then the ones on the room with no invite. Never someone
 *  turned away or taken out, and nobody twice. */
export const waitersOf = (
  asked: ReadonlyMap<string, { readonly name: string; readonly at: number }>,
  atDoor: ReadonlyArray<{ readonly key: string; readonly name: string }>,
  shut: (key: string) => boolean,
): ReadonlyArray<Waiter> => [
  ...[...asked].map(([key, ask]) => ({ key, name: ask.name, at: ask.at })).sort((first, second) => first.at - second.at),
  ...atDoor.filter((stranger) => !asked.has(stranger.key) && !shut(stranger.key)).map((stranger) => ({ key: stranger.key, name: stranger.name || stranger.key.slice(0, 8), at: null })),
];

/** "40 s", "3 min", "2 h": how long ago, for a line a person reads. */
export const agoText = (now: number, at: number): string => {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  return seconds < 90 ? `${seconds} s` : seconds < 90 * 60 ? `${Math.round(seconds / 60)} min` : `${Math.round(seconds / 3600)} h`;
};

const members = (count: number) => (count === 1 ? "1 member" : `${count} members`);

/** The one thing that keeps the room from working, first what blocks the
 *  most; null when nothing does. */
export const troubleOf = (state: RoomState): Trouble | null => {
  const nobody = state.here.length === 0;
  const unreachable = state.firewalled === true ? " This machine is not reachable directly, so a member on an open network has to be online." : "";
  if (state.refusal !== null) return { what: `Your invite was turned down: ${state.refusal}`, next: "Ask a member for a new invite.", brief: "your invite was turned down" };
  if (state.awaiting)
    return {
      what: `Waiting for a member to let you in — ${members(state.here.length)} connected.`,
      next: nobody ? `Nobody from the room is online: ask a member to open collagen.${unreachable}` : "Ask someone who may let people in to open collagen and let you in.",
      brief: "waiting to be let in",
    };
  const outdated = state.here.find((peer) => peer.protocol !== state.protocol);
  if (outdated) return { what: `${outdated.name} runs collagen protocol ${outdated.protocol}, you run ${state.protocol}: nothing gets through.`, next: "The older side updates: npm i -g @collagen/cli", brief: `${outdated.name} needs to update` };
  if (state.otherProtocol.length > 0) {
    const first = state.otherProtocol[0]!;
    return { what: `A peer (${first.key}) speaks collagen protocol ${first.protocol}, you speak ${state.protocol}: nothing of theirs is read.`, next: "The older side updates: npm i -g @collagen/cli", brief: "a peer needs to update" };
  }
  if (!state.logOpen && !state.invited)
    return {
      what: "You have no invite to this room, so nobody is asked to let you in.",
      next: nobody ? "Ask a member for one, then: collagen join <invite>" : "Ask a member for one (collagen join <invite>), or to let you in from their side: they see you at the door.",
      brief: "no invite: ask a member for one",
    };
  if (!state.logOpen)
    return {
      what: "The room's log has not opened yet.",
      next: nobody ? `A member hands it over: ask one to open collagen.${unreachable}` : "A connected member hands it over: give it a moment.",
      brief: nobody ? "waiting for a member to be online" : "a member is letting you in",
    };
  if (!state.writable)
    return {
      what: "You can read the room but not write to it yet.",
      next: nobody ? `A member lets you into the log on their own: ask one to open collagen.${unreachable}` : "A connected member lets you in on their own: give it a moment.",
      brief: nobody ? "waiting for a member to be online" : "a member is letting you in",
    };
  if (state.admitFailed.length > 0) {
    const failed = state.admitFailed[0]!;
    return { what: `Letting ${failed.name} into the room's log failed ${agoText(state.now, failed.at)} ago: ${failed.why}`, next: "It is tried again when they next ask; if it keeps failing, restart collagen.", brief: `letting ${failed.name} in failed` };
  }
  if (nobody && state.away.length > 0 && state.open === 0 && state.connecting === 0)
    return { what: `No member of the room is connected (${state.away.join(", ")} away).`, next: `What is written waits for them.${unreachable}`, brief: "no member connected" };
  return null;
};

/** Why you cannot write to the room yet, in a few words for the tab bar; null once you can. */
export const doorLine = (state: RoomState): string | null => {
  if (state.writable) return null;
  if (state.refusal !== null) return "your invite was turned down";
  if (state.awaiting) return "waiting to be let in";
  if (!state.logOpen && !state.invited) return "no invite: ask a member for one";
  return state.here.length === 0 && !state.logOpen ? "waiting for a member to be online" : "a member is letting you in";
};
