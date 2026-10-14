import { createHash } from "node:crypto";

/** Which net a run is on. A release is on mainnet; a run from source is on
 *  devnet. Same invite id, different topic, so the two never meet: nobody on
 *  the release walks into a room whose log is being reshaped by unreleased
 *  code, and anyone who pulls the branch joins it. */
export type Net = "mainnet" | "devnet";

/** Derive a 32-byte swarm topic from a room name, salted by net. */
export function roomTopic(roomName: string, net: Net = "mainnet"): Buffer {
  const salt = net === "devnet" ? "collagen-devnet" : "collagen";
  return createHash("sha256").update(`${salt}:${roomName}`).digest();
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
export function deriveThreadId(first: string, second: string, project: string): string {
  const [lower, higher] = first < second ? [first, second] : [second, first];
  return createHash("sha256").update(`${lower}|${higher}|${project}`).digest("hex").slice(0, 16);
}

/** An invite as people see and paste it: the room id, prefixed `devnet-` when
 *  the room is on devnet. The prefix is what lets the other net say
 *  "not here" at once, instead of waiting on a topic nobody announces on. */
export function formatInvite(roomId: string, net: Net): string {
  return net === "devnet" ? `devnet-${roomId}` : roomId;
}

export type ParsedInvite = { readonly id: string; readonly net: Net };

/** The inverse of formatInvite; null when the text is not an invite at all. */
export function parseInvite(text: string): ParsedInvite | null {
  const trimmed = text.trim();
  const dev = trimmed.startsWith("devnet-");
  const id = dev ? trimmed.slice(7) : trimmed;
  return isRoomId(id) ? { id, net: dev ? "devnet" : "mainnet" } : null;
}

/** A room id (= the invite) is a uuid, v7 in practice. Anything else is
 *  rejected at the edges so a botched paste can't silently become a new room. */
export function isRoomId(text: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text);
}
