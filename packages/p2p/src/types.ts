// Pure shared types not tied to the wire (wire shapes live in schema.ts,
// which is also browser-safe — plain `effect` Schema, no native deps).

/** Local identity: a keypair + display name. `keyPair` is node-only at runtime. */
export interface Identity {
  name: string;
  profile: string;
  keyPair: { publicKey: Buffer; secretKey: Buffer };
  pubkey: string;
}
