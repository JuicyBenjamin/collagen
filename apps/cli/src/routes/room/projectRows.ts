import type { LocalState, Peer, Project } from "@collagen/p2p";

/** One row in the room's project list: the union of everyone's projects.
 *  Active (white) when 2+ participants share the name — that's where
 *  cross-agent work can happen; single-holder projects are greyed out. */
export interface ProjectRow {
  name: string;
  mine: Project | undefined;
  holders: string[];
}

/** Pure derivation of state we already subscribe to — used by the tab bar
 *  (shared count) and the projects section (the list itself). */
export function projectRows(state: LocalState, roomId: string, peers: ReadonlyArray<Peer>): ProjectRow[] {
  const byName = new Map<string, ProjectRow>();
  for (const p of state.rooms[roomId] ?? []) byName.set(p.name, { name: p.name, mine: p, holders: ["you"] });
  for (const peer of peers) {
    for (const pp of peer.projects) {
      const row = byName.get(pp.name) ?? { name: pp.name, mine: undefined, holders: [] };
      row.holders.push(peer.name);
      byName.set(pp.name, row);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
