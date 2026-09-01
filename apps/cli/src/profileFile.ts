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
  room?: string;
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
