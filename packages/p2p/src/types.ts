// Pure shared types + domain shapes. No native deps — safe to import from a
// browser bundle (e.g. a future web client) via "@collagen/p2p/types".

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

export type Bootstrap = { host: string; port: number }[];

/** A user-owned project (a local repo/codebase the user's agent works on). */
export interface Project {
  id: string;
  name: string;
  path: string;
}

/** Local, per-user state (preferred AI + project pool + per-room enables). */
export interface LocalState {
  preferredAi: string | null;
  pool: Project[];
  rooms: Record<string, string[]>; // roomName -> enabled project ids
}

export const AI_OPTIONS = ["claude-code", "codex"] as const;

/** Local identity: a keypair + display name. `keyPair` is node-only at runtime. */
export interface Identity {
  name: string;
  profile: string;
  keyPair: { publicKey: Buffer; secretKey: Buffer };
  pubkey: string;
}
