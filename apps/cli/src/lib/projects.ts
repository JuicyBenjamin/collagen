import type { Peer } from "@collagen/p2p";

/** Projects are the same project when they share a name, however it is
 *  cased — "Collagen" and "collagen" are one project, one row on the panel.
 *  (Names match across peers; a git remote would catch two clones named
 *  differently, and is left for when locating exists and shows the need.) */
export const projectKey = (name: string): string => name.trim().toLowerCase();

/** The room's spelling of a project peers already share, when `name` is one,
 *  and who shares it — what a located copy is registered under, so one
 *  project stays one row whatever the folder on this machine is called. */
export function sharedProject(name: string, peers: ReadonlyArray<Peer>): { readonly name: string; readonly holders: ReadonlyArray<string> } | null {
  const key = projectKey(name);
  const holders = peers.filter((p) => p.projects.some((pp) => projectKey(pp.name) === key));
  if (holders.length === 0) return null;
  const spelled = holders[0]!.projects.find((pp) => projectKey(pp.name) === key)!.name;
  return { name: spelled, holders: holders.map((p) => p.name) };
}
