// Pure shared types not tied to the wire (wire shapes live in schema.ts,
// which is also browser-safe — plain `effect` Schema, no native deps).

/** Local identity: a keypair + display name. `keyPair` is node-only at runtime. */
export interface Identity {
  name: string;
  profile: string;
  keyPair: { publicKey: Buffer; secretKey: Buffer };
  /** The key the person is known by: what tickets, messages and roles name. */
  pubkey: string;
  /** This device's own key — `keyPair`'s public half: what connects, signs and is sealed for. The same as `pubkey` for someone on one device. */
  device: string;
}
