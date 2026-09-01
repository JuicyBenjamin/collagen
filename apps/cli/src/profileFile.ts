import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "./services/Identity";

/** Synchronous pre-runtime access to the per-profile config file. The TUI
 *  reads it before the Effect runtime exists (to decide whether to show the
 *  first-run setup) and writes it from the setup form; the Identity service
 *  remains the runtime-side reader/writer of the same file. */
export interface ProfileFile {
  seed?: string;
  name?: string;
  /** The room's identity — an unguessable id (uuid v7); the topic derives
   *  from this, so knowing the id IS the invite. */
  roomId?: string;
  /** Local display label for the room — cosmetic, changeable anytime. */
  roomName?: string;
}

export function storedRoom(f: ProfileFile): { id: string; name: string } | undefined {
  if (f.roomId === undefined) return undefined;
  return { id: f.roomId, name: f.roomName ?? f.roomId.slice(0, 8) };
}

export function profilePath(profile: string): string {
  return join(configDir, `identity-${profile}.json`);
}

export function readProfileFile(profile: string): ProfileFile {
  try {
    return JSON.parse(readFileSync(profilePath(profile), "utf8")) as ProfileFile;
  } catch {
    return {};
  }
}

export function writeProfileFile(profile: string, patch: Partial<ProfileFile>): void {
  const current = readProfileFile(profile);
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
  writeFileSync(profilePath(profile), JSON.stringify({ ...current, ...patch }));
}
