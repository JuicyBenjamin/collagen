import { PROTOCOL_VERSION, type AiStatus, type Member, type Peer } from "@collagen/p2p";
import { cells } from "./columns";

/** Everyone a room knows, as the overview and the people page show them. */
export interface Person {
  readonly key: string;
  readonly name: string;
  readonly you: boolean;
  /** here now: connected and looking at this room (an away peer is not) */
  readonly online: boolean;
  /** connected, but working in another room */
  readonly away: boolean;
  readonly ai: string | null;
  /** what stands in the way of working with them, in a few words */
  readonly problem: string | null;
  /** projects they share in this room; unknown (null) for someone offline */
  readonly projects: number | null;
}

const problemOf = (aiName: string | null, aiStatus: AiStatus | undefined, protocol: string): string | null =>
  protocol !== PROTOCOL_VERSION
    ? "other collagen version"
    : aiName !== null && aiStatus === "missing"
      ? "cli not found"
      : aiName !== null && aiStatus === "unauthenticated"
        ? "unauthed"
        : null;

const byName = (first: Person, second: Person) => first.name.localeCompare(second.name);

/** You first, then whoever is here by name, then the rest — away, then
 *  offline (remembered by the room's log), each by name. */
export function roomPeople(
  me: { readonly key: string; readonly name: string; readonly ai: string | null; readonly aiStatus: AiStatus; readonly projects: number },
  roster: ReadonlyArray<Peer>,
  members: ReadonlyArray<Member>,
): ReadonlyArray<Person> {
  const connected = new Set(roster.map((peer) => peer.key));
  const toPerson = (peer: Peer): Person => ({ key: peer.key, name: peer.name, you: false, online: !peer.away, away: peer.away, ai: peer.ai, problem: problemOf(peer.ai, peer.aiStatus, peer.protocol), projects: peer.projects.length });
  const you: Person = { key: me.key, name: me.name, you: true, online: true, away: false, ai: me.ai, problem: problemOf(me.ai, me.aiStatus, PROTOCOL_VERSION), projects: me.projects };
  const offline = members
    .filter((member) => member.key !== me.key && !connected.has(member.key))
    .map((member): Person => ({ key: member.key, name: member.name, you: false, online: false, away: false, ai: null, problem: null, projects: null }));
  return [
    you,
    ...roster.filter((peer) => !peer.away).map(toPerson).sort(byName),
    ...roster.filter((peer) => peer.away).map(toPerson).sort(byName),
    ...offline.sort(byName),
  ];
}

/** How many of `names` fit on a line `width` wide, joined by ", ", keeping
 *  room for " …" when some are left over — at least one, cut if it must be. */
export function fitNames(names: ReadonlyArray<string>, width: number): { readonly shown: number; readonly more: boolean } {
  let used = 0;
  for (let index = 0; index < names.length; index++) {
    const next = used + (index > 0 ? 2 : 0) + cells(names[index]!);
    const rest = index < names.length - 1 ? 2 : 0;
    if (next + rest > width && index > 0) return { shown: index, more: true };
    used = next;
  }
  return { shown: names.length, more: false };
}
