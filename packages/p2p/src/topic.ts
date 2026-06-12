import { createHash } from "node:crypto";

/** Derive a 32-byte swarm topic from a room name. */
export function roomTopic(roomName: string): Buffer {
  return createHash("sha256").update(`collagen:${roomName}`).digest();
}
