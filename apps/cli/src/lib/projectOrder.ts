import type { LocalState } from "@collagen/p2p";
import { projectKey } from "./projects";

// The order a person put a room's projects in. Theirs alone: kept on this
// machine with their other settings, never sent to the room, so each person
// sees the projects their own way. Every list of projects they see follows
// it (the projects tab, the merges tab, the merges page).

/** The names a room's projects were put in, first to last; none when never ordered. */
export const projectOrderOf = (state: Pick<LocalState, "projectOrder">, roomId: string): ReadonlyArray<string> => state.projectOrder?.[roomId] ?? [];

/** `items` as the person ordered them: those they placed, in their place,
 *  then the rest (new since, or never placed) by name. */
export const inProjectOrder = <T>(items: ReadonlyArray<T>, nameOf: (item: T) => string, order: ReadonlyArray<string>): Array<T> => {
  const place = new Map(order.map((name, index) => [projectKey(name), index] as const));
  const rank = (item: T): number => place.get(projectKey(nameOf(item))) ?? order.length;
  return [...items].sort((a, b) => rank(a) - rank(b) || nameOf(a).localeCompare(nameOf(b)));
};

/** The state with a room's projects in the order `names` gives. Names
 *  placed before and not given now (a peer's project while they are
 *  offline) keep a place after them, so it holds when they are back. */
export const withProjectOrder = (state: LocalState, roomId: string, names: ReadonlyArray<string>): LocalState => {
  const given = new Set(names.map(projectKey));
  const kept = projectOrderOf(state, roomId).filter((name) => !given.has(projectKey(name)));
  return { ...state, projectOrder: { ...state.projectOrder, [roomId]: [...names, ...kept] } };
};
