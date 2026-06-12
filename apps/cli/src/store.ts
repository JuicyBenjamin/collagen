import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { LocalState } from "@collagen/p2p";

// CLI-specific persistence of LocalState (the shape lives in @collagen/p2p).
const dir = join(homedir(), ".config", "collagen");

function file(profile: string): string {
  return join(dir, `state-${profile}.json`);
}

export function loadState(profile: string): LocalState {
  try {
    if (existsSync(file(profile))) {
      const j = JSON.parse(readFileSync(file(profile), "utf8")) as Partial<LocalState>;
      return { preferredAi: j.preferredAi ?? null, pool: j.pool ?? [], rooms: j.rooms ?? {} };
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
