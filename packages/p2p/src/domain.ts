import { randomUUID } from "node:crypto";
import type { LocalState, Project } from "./schema";

export function newProject(name: string, path: string): Project {
  return { id: randomUUID(), name, path };
}

/** Projects enabled in a given room, resolved against the pool. */
export function roomProjects(state: LocalState, room: string): ReadonlyArray<Project> {
  const ids = new Set(state.rooms[room] ?? []);
  return state.pool.filter((p) => ids.has(p.id));
}
