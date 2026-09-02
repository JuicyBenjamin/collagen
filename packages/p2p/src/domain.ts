import { randomUUID } from "node:crypto";
import type { LocalState, Project } from "./schema";

export function newProject(name: string, path: string): Project {
  return { id: randomUUID(), name, path };
}

/** The projects that live in a given room. */
export function roomProjects(state: LocalState, room: string): ReadonlyArray<Project> {
  return state.rooms[room] ?? [];
}
