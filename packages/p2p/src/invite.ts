import crypto from "hypercore-crypto";
import b4a from "b4a";
import sodium from "sodium-universal";
import type { Net } from "./topic";

// Invites that let someone in once. An invite is not the room's key: it is a
// one-time secret whose public half is on the room's log. The newcomer finds
// a member on the room's topic and proves they hold the secret; the member
// checks it against the log, lets them in, hands over the room's keys over
// the connection (already end-to-end encrypted) and marks the invite used.
// Anyone who sees an old invite can do nothing with it.

/** How long an invite can be used before it lapses. */
export const INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/** An invite as it is pasted: which net, the room's name (its topic), the
 *  room's log key, the invite's id and the secret that proves it —
 *  `[devnet-]<room>.<log>.<id>.<secret>`. The log key lets the newcomer tell
 *  the room's real keys from a stranger's: anyone holding an old invite can
 *  sit on the topic, but cannot answer for that log. */
export interface Invite {
  readonly net: Net;
  readonly roomName: string;
  readonly logKey: string;
  readonly id: string;
  /** 32 bytes, hex: the seed of the key pair whose public half is on the log */
  readonly secret: string;
}

export function formatInvite(invite: Invite): string {
  return `${invite.net === "devnet" ? "devnet-" : ""}${invite.roomName}.${invite.logKey}.${invite.id}.${invite.secret}`;
}

/** The inverse of formatInvite; null when the text is not an invite of this shape. */
export function parseInvite(text: string): Invite | null {
  const trimmed = text.trim();
  const dev = trimmed.startsWith("devnet-");
  const parts = (dev ? trimmed.slice(7) : trimmed).split(".");
  if (parts.length !== 4) return null;
  const [roomName, logKey, id, secret] = parts as [string, string, string, string];
  if (roomName.length === 0 || !/^[0-9a-f]{64}$/.test(logKey) || !/^[0-9a-f]{16}$/.test(id) || !/^[0-9a-f]{64}$/.test(secret)) return null;
  return { net: dev ? "devnet" : "mainnet", roomName, logKey, id, secret };
}

/** A new invite for a room: the invite to hand out, and the public half that
 *  goes on the room's log. */
export function newInvite(roomName: string, net: Net, logKey: string): { readonly invite: Invite; readonly publicKey: string } {
  const seed = crypto.randomBytes(32);
  const pair = crypto.keyPair(seed);
  return {
    invite: { net, roomName, logKey, id: b4a.toString(crypto.randomBytes(8), "hex"), secret: b4a.toString(seed, "hex") },
    publicKey: b4a.toString(pair.publicKey, "hex"),
  };
}

/** What a newcomer signs: this invite, for this room, for this identity —
 *  so a proof overheard can't be replayed for anyone else or anywhere else. */
const proofMessage = (roomName: string, inviteId: string, identity: string) => b4a.from(`collagen-invite|${roomName}|${inviteId}|${identity}`);

/** The newcomer's proof that they hold the invite's secret. */
export function proveInvite(invite: Invite, identity: string): string {
  const pair = crypto.keyPair(b4a.from(invite.secret, "hex"));
  return b4a.toString(crypto.sign(proofMessage(invite.roomName, invite.id, identity), pair.secretKey), "hex");
}

/** Whether `proof` shows `identity` holds the secret of the invite whose public half is `publicKey`. */
export function checkProof(roomName: string, inviteId: string, publicKey: string, identity: string, proof: string): boolean {
  if (!/^[0-9a-f]{128}$/.test(proof) || !/^[0-9a-f]{64}$/.test(publicKey)) return false;
  return crypto.verify(proofMessage(roomName, inviteId, identity), b4a.from(proof, "hex"), b4a.from(publicKey, "hex"));
}

/** Seal a secret so only the holder of one identity can open it: their
 *  signing key turned into the box key it stands for. Base64. */
export function sealFor(identity: string, secret: Uint8Array): string | null {
  const boxKey = b4a.alloc(sodium.crypto_box_PUBLICKEYBYTES);
  try {
    sodium.crypto_sign_ed25519_pk_to_curve25519(boxKey, b4a.from(identity, "hex"));
  } catch {
    return null;
  }
  return b4a.toString(crypto.encrypt(b4a.from(secret), boxKey), "base64");
}

/** Open a secret sealed for us with our identity's key pair; null when it was not sealed for us. */
export function openSealed(sealed: string, keyPair: { readonly publicKey: Uint8Array; readonly secretKey: Uint8Array }): Uint8Array | null {
  const publicKey = b4a.alloc(sodium.crypto_box_PUBLICKEYBYTES);
  const secretKey = b4a.alloc(sodium.crypto_box_SECRETKEYBYTES);
  try {
    sodium.crypto_sign_ed25519_pk_to_curve25519(publicKey, b4a.from(keyPair.publicKey));
    sodium.crypto_sign_ed25519_sk_to_curve25519(secretKey, b4a.from(keyPair.secretKey));
  } catch {
    return null;
  }
  return crypto.decrypt(b4a.from(sealed, "base64"), { publicKey, secretKey });
}
