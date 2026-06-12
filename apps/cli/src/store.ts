import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

export interface Project {
  id: string;
  name: string;
  path: string;
}

export interface LocalState {
  preferredAi: string | null;
  pool: Project[];
  rooms: Record<string, string[]>; // roomName -> enabled project ids
}

export const AI_OPTIONS = ["claude-code", "codex"] as const;

const dir = join(homedir(), ".config", "collagen");

function file(profile: string): string {
  return join(dir, `state-${profile}.json`);
}

export function loadState(profile: string): LocalState {
  try {
    if (existsSync(file(profile))) {
      const j = JSON.parse(readFileSync(file(profile), "utf8")) as Partial<LocalState>;
      return {
        preferredAi: j.preferredAi ?? null,
        pool: j.pool ?? [],
        rooms: j.rooms ?? {},
      };
    }
  } catch {
    // fall through to default
  }
  return { preferredAi: null, pool: [], rooms: {} };
}

export function saveState(profile: string, state: LocalState): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(file(profile), JSON.stringify(state, null, 2));
}

export function newProject(name: string, path: string): Project {
  return { id: randomUUID(), name, path };
}

/** Projects enabled in a given room, resolved against the pool. */
export function roomProjects(state: LocalState, room: string): Project[] {
  const ids = new Set(state.rooms[room] ?? []);
  return state.pool.filter((p) => ids.has(p.id));
}
