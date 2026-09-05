import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "./services/Identity";

/** Synchronous pre-runtime access to the per-profile config file. The TUI
 *  reads it before the Effect runtime exists (to decide whether to show the
 *  first-run setup) and writes it from the setup form; the Identity service
 *  remains the runtime-side reader/writer of the same file. */
export interface RoomEntry {
  /** The room's identity — an unguessable id (uuid v7); the topic derives
   *  from this, so knowing the id IS the invite. */
  id: string;
  /** The room's shared display name (broadcast, last-writer-wins). */
  name: string;
  /** When `name` was last set; 0/absent = local default, any peer's named
   *  version wins over it. */
  nameTs?: number;
}

export interface ProfileFile {
  seed?: string;
  name?: string;
  /** Every room this profile has joined; the process runs in one at a time. */
  rooms?: RoomEntry[];
  activeRoomId?: string;
}

export function storedRoom(f: ProfileFile): RoomEntry | undefined {
  const rooms = f.rooms ?? [];
  return rooms.find((r) => r.id === f.activeRoomId) ?? rooms[0];
}

/** Add-or-relabel a room WITHOUT touching which room is active — for
 *  persisting broadcast state about the room we're in. */
export function upsertRoom(profile: string, room: RoomEntry): void {
  const f = readProfileFile(profile);
  const rooms = (f.rooms ?? []).filter((r) => r.id !== room.id);
  writeProfileFile(profile, { rooms: [...rooms, room] });
}

/** Add-or-relabel a room and make it active (an explicit create/join/switch). */
export function upsertActiveRoom(profile: string, room: RoomEntry): void {
  upsertRoom(profile, room);
  writeProfileFile(profile, { activeRoomId: room.id });
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
