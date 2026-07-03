import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import Hyperswarm from "hyperswarm";
import b4a from "b4a";
import { roomTopic } from "./topic";
import type { Bootstrap, Identity, Peer, SharedProfile } from "./types";

export const bootstrapFile = join(homedir(), ".config", "collagen", "dev-bootstrap.json");

export function loadDevBootstrap(): Bootstrap | undefined {
  try {
    if (!existsSync(bootstrapFile)) return undefined;
    return JSON.parse(readFileSync(bootstrapFile, "utf8")) as Bootstrap;
  } catch {
    return undefined;
  }
}

/** A directed message from one peer to another within a room. */
export interface RoomMessage {
  id: string;
  /** Conversation key — deterministic per sender|recipient|project, so messages
   *  about the same topic continue in the same AI session on the recipient. */
  threadId: string;
  from: string; // sender pubkey (hex)
  fromName: string;
  project: string;
  intent: string;
  findings: string;
  ts: number;
}

function deriveThreadId(a: string, b: string, project: string): string {
  // Symmetric: sort the two keys so A→B and B→A land in the same thread,
  // keeping replies in the same AI session on both sides.
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return createHash("sha256").update(`${lo}|${hi}|${project}`).digest("hex").slice(0, 16);
}

interface ProfileFrame {
  kind: "profile";
  profile: SharedProfile;
}
interface MessageFrame {
  kind: "msg";
  msg: RoomMessage;
}
type Frame = ProfileFrame | MessageFrame;

export interface RoomHandlers {
  onRoster?: (peers: Peer[]) => void;
  onMessage?: (msg: RoomMessage) => void;
}

export interface RoomHandle {
  ready: Promise<void>;
  /** Re-broadcast the local profile to all peers (after a settings change). */
  update: () => void;
  /** Send a directed message to a peer (by pubkey). Returns false if not connected. */
  sendTo: (peerKey: string, payload: { project: string; intent: string; findings: string }) => boolean;
  destroy: () => Promise<void>;
}

/**
 * Join a room's Hyperswarm topic: exchange presence profiles AND carry directed
 * messages over the same connections. Live-only (no offline queue yet).
 */
export function joinRoom(
  identity: Identity,
  roomName: string,
  getProfile: () => SharedProfile,
  handlers: RoomHandlers,
  opts: { bootstrap?: Bootstrap } = {},
): RoomHandle {
  const swarm = new Hyperswarm({ keyPair: identity.keyPair, bootstrap: opts.bootstrap });
  const connByKey = new Map<string, any>();
  const peers = new Map<string, Peer>();
  const emit = () => handlers.onRoster?.([...peers.values()]);

  const write = (conn: any, frame: Frame) => {
    try {
      conn.write(b4a.from(JSON.stringify(frame)));
    } catch {
      // peer mid-teardown
    }
  };

  swarm.on("connection", (conn: any, info: { publicKey: Buffer }) => {
    const key = b4a.toString(info.publicKey, "hex");
    connByKey.set(key, conn);
    conn.on("error", () => {});
    write(conn, { kind: "profile", profile: getProfile() });
    conn.on("data", (d: Buffer) => {
      let frame: Frame;
      try {
        frame = JSON.parse(b4a.toString(d)) as Frame;
      } catch {
        return;
      }
      if (frame.kind === "profile") {
        const p = frame.profile;
        peers.set(key, { key, name: p.name ?? "anon", ai: p.ai ?? null, projects: p.projects ?? [] });
        emit();
      } else if (frame.kind === "msg") {
        handlers.onMessage?.(frame.msg);
      }
    });
    conn.on("close", () => {
      connByKey.delete(key);
      peers.delete(key);
      emit();
    });
  });

  const discovery = swarm.join(roomTopic(roomName), { server: true, client: true });
  const ready: Promise<void> = discovery.flushed().then(() => undefined);
  ready.catch(() => {});

  return {
    ready,
    update: () => {
      const frame: Frame = { kind: "profile", profile: getProfile() };
      for (const conn of connByKey.values()) write(conn, frame);
    },
    sendTo: (peerKey, payload) => {
      const conn = connByKey.get(peerKey);
      if (!conn) return false;
      const msg: RoomMessage = {
        id: randomUUID(),
        threadId: deriveThreadId(identity.pubkey, peerKey, payload.project),
        from: identity.pubkey,
        fromName: identity.name,
        project: payload.project,
        intent: payload.intent,
        findings: payload.findings,
        ts: Date.now(),
      };
      write(conn, { kind: "msg", msg });
      return true;
    },
    destroy: async () => {
      await swarm.destroy();
    },
  };
}
