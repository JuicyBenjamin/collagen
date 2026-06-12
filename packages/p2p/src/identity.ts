import crypto from "hypercore-crypto";
import b4a from "b4a";

/** A fresh 32-byte seed (hex) — persist this to keep a stable identity. */
export function randomSeedHex(): string {
  return b4a.toString(crypto.randomBytes(32), "hex");
}

/** Derive a keypair from a hex seed. */
export function keyPairFromSeed(seedHex: string): { publicKey: Buffer; secretKey: Buffer } {
  return crypto.keyPair(b4a.from(seedHex, "hex"));
}

export function pubkeyHex(publicKey: Buffer): string {
  return b4a.toString(publicKey, "hex");
}
