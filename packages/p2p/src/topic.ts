import { createHash } from "node:crypto";

/** Derive a 32-byte swarm topic from a room name. */
export function roomTopic(roomName: string): Buffer {
  return createHash("sha256").update(`collagen:${roomName}`).digest();
}

/** Short, human-pasteable room identifier for LOCAL disambiguation (agents,
 *  logs, UI). Derived by hashing, so it never changes when the room's label
 *  does, and never reveals the full id (which doubles as the invite secret).
 *  Uniqueness only needs to hold across the handful of rooms one user has. */
export function shortRoomId(roomId: string): string {
  return createHash("sha256").update(`collagen-short:${roomId}`).digest("hex").slice(0, 8);
}

/** Conversation key — symmetric (sorted keys), so A→B and B→A about one
 *  project land in the same thread and replies continue the same AI session
 *  on both sides. */
export function deriveThreadId(a: string, b: string, project: string): string {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return createHash("sha256").update(`${lo}|${hi}|${project}`).digest("hex").slice(0, 16);
}

/** A room id (= the invite) is a uuid, v7 in practice. Anything else is
 *  rejected at the edges so a botched paste can't silently become a new room. */
export function isRoomId(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
