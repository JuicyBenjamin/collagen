import { createHash } from "node:crypto";
import crypto from "hypercore-crypto";
import b4a from "b4a";
import type { Net } from "./topic";

// A code that makes another machine one of a person's devices. Like an
// invite: a one-time secret, made on the parent device and pasted on the
// other one. Making it is the parent's half of the handshake — it waits for
// whoever comes with the code; entering it is the other half. The two find
// each other on a topic only the code names, so they need no room in common.

/** How long a device code can be used. */
export const DEVICE_CODE_LIFETIME_MS = 10 * 60_000;

/** A device code as it is pasted: `[devnet-]device.<person>.<id>.<secret>`. */
export interface DeviceCode {
  readonly net: Net;
  /** the key the person is known by */
  readonly person: string;
  readonly id: string;
  /** 32 bytes, hex: the seed of the key pair whose public half the parent keeps */
  readonly secret: string;
}

export const formatDeviceCode = (code: DeviceCode): string => `${code.net === "devnet" ? "devnet-" : ""}device.${code.person}.${code.id}.${code.secret}`;

/** The inverse of formatDeviceCode; null when the text is not a device code. */
export const parseDeviceCode = (text: string): DeviceCode | null => {
  const trimmed = text.trim();
  const dev = trimmed.startsWith("devnet-");
  const parts = (dev ? trimmed.slice(7) : trimmed).split(".");
  if (parts.length !== 4 || parts[0] !== "device") return null;
  const [, person, id, secret] = parts as [string, string, string, string];
  if (!/^[0-9a-f]{64}$/.test(person) || !/^[0-9a-f]{16}$/.test(id) || !/^[0-9a-f]{64}$/.test(secret)) return null;
  return { net: dev ? "devnet" : "mainnet", person, id, secret };
};

/** A new code for a person: the code to hand over, and the public half the parent keeps to check it. */
export const newDeviceCode = (person: string, net: Net): { readonly code: DeviceCode; readonly publicKey: string } => {
  const seed = crypto.randomBytes(32);
  return { code: { net, person, id: b4a.toString(crypto.randomBytes(8), "hex"), secret: b4a.toString(seed, "hex") }, publicKey: b4a.toString(crypto.keyPair(seed).publicKey, "hex") };
};

/** What the device signs with the code's secret: this code, for this person, for this device — overheard, it serves nobody else. */
const proofText = (person: string, id: string, device: string) => b4a.from(`collagen-device-code|${person}|${id}|${device}`);

/** The device's proof that it holds the code. */
export const proveDeviceCode = (code: DeviceCode, device: string): string =>
  b4a.toString(crypto.sign(proofText(code.person, code.id, device), crypto.keyPair(b4a.from(code.secret, "hex")).secretKey), "hex");

/** Whether `proof` shows `device` holds the code whose public half is `publicKey`. */
export const checkDeviceCode = (person: string, id: string, publicKey: string, device: string, proof: string): boolean => {
  if (!/^[0-9a-f]{128}$/.test(proof) || !/^[0-9a-f]{64}$/.test(publicKey)) return false;
  try {
    return crypto.verify(proofText(person, id, device), b4a.from(proof, "hex"), b4a.from(publicKey, "hex"));
  } catch {
    return false;
  }
};

/** Where the two meet: named by the code's id and its public half, which only the code gives. */
export const deviceCodeTopic = (code: DeviceCode): Buffer =>
  createHash("sha256").update(`${code.net === "devnet" ? "collagen-devnet" : "collagen"}:device-code:${code.id}:${b4a.toString(crypto.keyPair(b4a.from(code.secret, "hex")).publicKey, "hex")}`).digest();
