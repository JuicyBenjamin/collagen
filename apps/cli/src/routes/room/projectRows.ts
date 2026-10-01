import type { LocalState, Peer, Project } from "@collagen/p2p";
import { projectKey } from "../../lib/projects";

/** One row in the room's project list: a PROJECT, however many people share
 *  it — not a share per person. Active (white) when 2+ participants share the
 *  name — that's where cross-agent work can happen; single-holder projects are
 *  greyed out. A project peers share that is not on this machine yet has no
 *  `mine`: the person's action there is to point collagen at their copy
 *  (locate), not to add a project that plainly exists. */
export interface ProjectRow {
  name: string;
  mine: Project | undefined;
  holders: string[];
}

/** Pure derivation of state we already subscribe to — used by the tab bar
 *  (shared count) and the projects section (the list itself). Your spelling
 *  wins for a project you hold; otherwise the first peer's. */
export function projectRows(state: LocalState, roomId: string, peers: ReadonlyArray<Peer>): ProjectRow[] {
  const byName = new Map<string, ProjectRow>();
  for (const p of state.rooms[roomId] ?? []) byName.set(projectKey(p.name), { name: p.name, mine: p, holders: ["you"] });
  for (const peer of peers) {
    for (const pp of peer.projects) {
      const key = projectKey(pp.name);
      const row = byName.get(key) ?? { name: pp.name, mine: undefined, holders: [] };
      if (!row.holders.includes(peer.name)) row.holders.push(peer.name);
      byName.set(key, row);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
