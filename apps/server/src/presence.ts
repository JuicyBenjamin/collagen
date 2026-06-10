import type { ServerMessage } from "./protocol";

/** A connected client we can push messages to. */
export interface Connection {
  send: (message: ServerMessage) => void;
}

/**
 * In-memory presence registry, keyed by workspace.
 * One process, no persistence yet — swap for Redis/pubsub when we scale out.
 */
export class PresenceRegistry {
  private readonly rooms = new Map<string, Map<string, Connection>>();

  join(workspaceId: string, clientId: string, conn: Connection): number {
    let room = this.rooms.get(workspaceId);
    if (!room) {
      room = new Map();
      this.rooms.set(workspaceId, room);
    }
    room.set(clientId, conn);
    return room.size;
  }

  leave(workspaceId: string, clientId: string): number {
    const room = this.rooms.get(workspaceId);
    if (!room) return 0;
    room.delete(clientId);
    if (room.size === 0) {
      this.rooms.delete(workspaceId);
      return 0;
    }
    return room.size;
  }

  count(workspaceId: string): number {
    return this.rooms.get(workspaceId)?.size ?? 0;
  }

  /** Push a message to every client in a workspace. */
  broadcast(workspaceId: string, message: ServerMessage): void {
    const room = this.rooms.get(workspaceId);
    if (!room) return;
    for (const conn of room.values()) conn.send(message);
  }
}
