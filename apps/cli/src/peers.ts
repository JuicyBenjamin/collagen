import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import Hyperswarm from "hyperswarm";
import b4a from "b4a";
import type { Identity } from "./identity";

export type Bootstrap = { host: string; port: number }[];

// In dev, `pnpm --filter @collagen/cli dev:net` writes a local testnet's
// bootstrap here so same-machine peers connect reliably (no public-DHT
// hairpinning). Absent in production → real DHT.
const bootstrapFile = join(homedir(), ".config", "collagen", "dev-bootstrap.json");

export function loadDevBootstrap(): Bootstrap | undefined {
  try {
    if (!existsSync(bootstrapFile)) return undefined;
    return JSON.parse(readFileSync(bootstrapFile, "utf8")) as Bootstrap;
  } catch {
    return undefined;
  }
}

export { bootstrapFile };

export interface SharedProject {
  name: string;
  path: string;
}

/** What each peer broadcasts about itself in a room. */
export interface SharedProfile {
  name: string;
  ai: string | null;
  projects: SharedProject[];
}

export interface Peer extends SharedProfile {
  key: string;
}

/** Derive a 32-byte swarm topic from a room name. */
export function roomTopic(roomName: string): Buffer {
  return createHash("sha256").update(`collagen:${roomName}`).digest();
}

export interface PresenceHandle {
  ready: Promise<void>;
  /** Re-broadcast the local profile to all connected peers (after a change). */
  update: () => void;
  destroy: () => Promise<void>;
}

/**
 * Join a room's Hyperswarm topic and track who's present. No server: peers
 * discover each other via the DHT and exchange their profile (name + preferred
 * AI + enabled projects) directly. `getProfile` is read live so `update()` can
 * re-broadcast after the user changes settings. `bootstrap` is for tests.
 */
export function joinRoom(
  identity: Identity,
  roomName: string,
  getProfile: () => SharedProfile,
  onRoster: (peers: Peer[]) => void,
  opts: { bootstrap?: { host: string; port: number }[] } = {},
): PresenceHandle {
  const swarm = new Hyperswarm({ keyPair: identity.keyPair, bootstrap: opts.bootstrap });
  const conns = new Set<any>();
  const peers = new Map<string, Peer>();
  const emit = () => onRoster([...peers.values()]);
  const send = (conn: any) => {
    try {
      conn.write(b4a.from(JSON.stringify(getProfile())));
    } catch {
      // peer may be mid-teardown
    }
  };

  swarm.on("connection", (conn: any, info: { publicKey: Buffer }) => {
    const key = b4a.toString(info.publicKey, "hex");
    conns.add(conn);
    conn.on("error", () => {});
    send(conn);
    conn.on("data", (d: Buffer) => {
      try {
        const p = JSON.parse(b4a.toString(d)) as SharedProfile;
        peers.set(key, { key, name: p.name ?? "anon", ai: p.ai ?? null, projects: p.projects ?? [] });
        emit();
      } catch {
        // ignore non-JSON frames
      }
    });
    conn.on("close", () => {
      conns.delete(conn);
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
      for (const conn of conns) send(conn);
    },
    destroy: async () => {
      await swarm.destroy();
    },
  };
}
