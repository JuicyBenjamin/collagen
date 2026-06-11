import type { Member, ServerMessage } from "./protocol";

/** A connected client we can push messages to. */
export interface Connection {
  send: (message: ServerMessage) => void;
}

interface Entry {
  conn: Connection;
  name: string;
}

/**
 * In-memory presence registry, keyed by room (workspace = team id).
 * Tracks who is in each room, not just a count. One process, no persistence —
 * swap for Redis/pubsub when we scale out.
 */
export class PresenceRegistry {
  private readonly rooms = new Map<string, Map<string, Entry>>();

  join(roomId: string, clientId: string, name: string, conn: Connection): Member[] {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = new Map();
      this.rooms.set(roomId, room);
    }
    room.set(clientId, { conn, name });
    return this.roster(roomId);
  }

  leave(roomId: string, clientId: string): Member[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    room.delete(clientId);
    if (room.size === 0) this.rooms.delete(roomId);
    return this.roster(roomId);
  }

  roster(roomId: string): Member[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    return [...room.entries()].map(([clientId, e]) => ({ clientId, name: e.name }));
  }

  /** Push a message to every client in a room. */
  broadcast(roomId: string, message: ServerMessage): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    for (const e of room.values()) e.conn.send(message);
  }
}
