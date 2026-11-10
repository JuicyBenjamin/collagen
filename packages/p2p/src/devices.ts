import crypto from "hypercore-crypto";
import b4a from "b4a";
import { Schema } from "effect";
import { canonical } from "./signing";

// One person, several devices. A person is known by the key of the device
// they started on; every device has a key of its own, and signed acts say
// which devices are that person's. One device is the parent: only it takes
// devices in, puts them out, and hands the parent's part on. The acts are
// bound to the person, not to a room, so the same ones stand in every room
// the person is in.
//
// The parent's acts form a chain: each names the one it follows (`after`).
// They count in that order whatever order they arrive in. Two acts that
// follow the same one cannot both be the parent's honest word (it handed its
// part on, then spoke again): the first in the log stands.

export const DeviceAct = Schema.Union([
  /** a device taken in. `consent` is that device's own signature (signConsent): nobody is made someone's device unasked */
  Schema.Struct({ kind: Schema.Literal("link"), device: Schema.String, name: Schema.String, consent: Schema.String }),
  /** a device put out: nothing it signs from here counts as the person's */
  Schema.Struct({ kind: Schema.Literal("unlink"), device: Schema.String }),
  /** the parent's part handed to another of the person's devices */
  Schema.Struct({ kind: Schema.Literal("parent"), device: Schema.String }),
  /** what a device is called; any of the person's devices may say */
  Schema.Struct({ kind: Schema.Literal("name"), device: Schema.String, name: Schema.String }),
]);
export type DeviceAct = typeof DeviceAct.Type;

/** One signed act about a person's devices. */
export const DeviceEntry = Schema.Struct({
  id: Schema.String,
  /** whose devices it is about: the key the person is known by */
  person: Schema.String,
  /** the device that made it, and signed it */
  by: Schema.String,
  at: Schema.Finite,
  /** the parent's act this one follows, null for the first; a name follows nothing */
  after: Schema.NullOr(Schema.String),
  act: DeviceAct,
  sig: Schema.String,
});
export type DeviceEntry = typeof DeviceEntry.Type;

type KeyPair = { readonly secretKey: Uint8Array };
const KEY = /^[0-9a-f]{64}$/;
const SIGNATURE = /^[0-9a-f]{128}$/;

const sign = (text: string, keyPair: KeyPair): string => b4a.toString(crypto.sign(b4a.from(text), keyPair.secretKey), "hex");
const verify = (text: string, signature: string, key: string): boolean => {
  if (!SIGNATURE.test(signature) || !KEY.test(key)) return false;
  try {
    return crypto.verify(b4a.from(text), b4a.from(signature, "hex"), b4a.from(key, "hex"));
  } catch {
    return false;
  }
};

const consentText = (person: string, device: string) => `collagen-device-join|${person}|${device}`;
const entryText = (entry: Omit<DeviceEntry, "sig">) => `collagen-device|${canonical({ id: entry.id, person: entry.person, by: entry.by, at: entry.at, after: entry.after, act: entry.act })}`;

/** A device's own word that it becomes one of `person`'s: made on that device, carried in the parent's link. */
export const signConsent = (person: string, device: string, keyPair: KeyPair): string => sign(consentText(person, device), keyPair);

/** Sign an act with the key pair of the device that makes it. */
export const signDevice = (entry: Omit<DeviceEntry, "sig">, keyPair: KeyPair): DeviceEntry => ({ ...entry, sig: sign(entryText(entry), keyPair) });

/** Whether an act was signed by the device it names. */
export const verifyDevice = (entry: DeviceEntry): boolean => verify(entryText(entry), entry.sig, entry.by);

/** One person's devices, as the acts stand. */
export interface PersonDevices {
  readonly person: string;
  /** the device that may take devices in, put them out, and hand this part on */
  readonly parent: string;
  /** the devices that are this person now, by key, with what each is called ("" until named) */
  readonly devices: ReadonlyMap<string, string>;
  /** the parent's last act that counted: what its next one follows */
  readonly head: string | null;
}

/** Whose device every key is. */
export interface Devices {
  /** every person some act that counted is about */
  readonly persons: ReadonlyMap<string, PersonDevices>;
  /** each device taken in by someone else: whose it is */
  readonly owner: ReadonlyMap<string, string>;
  /** each device put out, and by whom: it is nobody's now */
  readonly gone: ReadonlyMap<string, string>;
}

export const NO_DEVICES: Devices = { persons: new Map(), owner: new Map(), gone: new Map() };

/** The person a key acts as: whoever took it in as a device; itself when
 *  nobody did; null once it was put out. */
export const personOf = (devices: Devices, key: string): string | null => (devices.gone.has(key) ? null : (devices.owner.get(key) ?? key));

/** A person's devices; someone no act is about is their one device, and its parent. */
export const devicesOf = (devices: Devices, person: string): PersonDevices =>
  devices.persons.get(person) ?? { person, parent: person, devices: new Map([[person, ""]]), head: null };

/** The acts folded. The parent's acts count along their chain, so the result
 *  is the same whatever order they arrived in; log order decides only between
 *  two acts that follow the same one. Names are the last said, by `at`, then id. */
export const foldDevices = (entries: ReadonlyArray<DeviceEntry>): Devices => {
  const persons = new Map<string, { parent: string; devices: Map<string, string>; head: string | null }>();
  const owner = new Map<string, string>();
  const gone = new Map<string, string>();
  const stateOf = (person: string) => {
    const known = persons.get(person);
    if (known) return known;
    const fresh = { parent: person, devices: new Map([[person, ""]]), head: null };
    persons.set(person, fresh);
    return fresh;
  };
  const seen = new Set<string>();
  const valid = entries.filter((entry) => {
    if (seen.has(entry.id) || !KEY.test(entry.person) || !verifyDevice(entry)) return false;
    seen.add(entry.id);
    return true;
  });

  /** Whether `key` is free to become someone's device: its own person, alone, never put out. */
  const free = (key: string) => !owner.has(key) && !gone.has(key) && (persons.get(key)?.devices.size ?? 1) === 1 && (persons.get(key)?.parent ?? key) === key;

  /** A parent's act, if it counts as things stand: applied, and true. */
  const apply = (entry: DeviceEntry): boolean => {
    const act = entry.act;
    // a person who is someone's device has no devices of their own
    if (owner.has(entry.person) && !persons.has(entry.person)) return false;
    const state = persons.get(entry.person) ?? { parent: entry.person, devices: new Map([[entry.person, ""]]), head: null as string | null };
    if (entry.by !== state.parent || entry.after !== state.head) return false;
    switch (act.kind) {
      case "link":
        if (act.device === entry.person || !free(act.device) || !verify(consentText(entry.person, act.device), act.consent, act.device)) return false;
        stateOf(entry.person).devices.set(act.device, act.name);
        owner.set(act.device, entry.person);
        break;
      case "unlink":
        // the parent hands its part on before it goes
        if (act.device === state.parent || !state.devices.has(act.device)) return false;
        stateOf(entry.person).devices.delete(act.device);
        owner.delete(act.device);
        gone.set(act.device, entry.person);
        break;
      case "parent":
        if (act.device === state.parent || !state.devices.has(act.device)) return false;
        stateOf(entry.person).parent = act.device;
        break;
      case "name":
        return false;
    }
    stateOf(entry.person).head = entry.id;
    return true;
  };

  // along each chain: an act that arrived before the one it follows counts once that one has
  // (after each one that counts, from the top again: of two that follow the same act, the first in the log)
  const waiting = valid.filter((entry) => entry.act.kind !== "name");
  for (let next = waiting.findIndex(apply); next !== -1; next = waiting.findIndex(apply)) waiting.splice(next, 1);

  // names: said by one of the person's devices, about one of them; the last said stands
  const named = new Map<string, DeviceEntry>();
  for (const entry of valid) {
    const act = entry.act;
    if (act.kind !== "name") continue;
    const state = persons.get(entry.person) ?? (entry.person === act.device && entry.by === entry.person && !owner.has(entry.person) ? stateOf(entry.person) : undefined);
    if (!state || !state.devices.has(entry.by) || !state.devices.has(act.device)) continue;
    const before = named.get(act.device);
    if (!before || entry.at > before.at || (entry.at === before.at && entry.id > before.id)) named.set(act.device, entry);
  }
  for (const [device, entry] of named) if (entry.act.kind === "name") persons.get(entry.person)?.devices.set(device, entry.act.name);

  return { persons: new Map([...persons].map(([person, state]) => [person, { person, ...state }])), owner, gone };
};
