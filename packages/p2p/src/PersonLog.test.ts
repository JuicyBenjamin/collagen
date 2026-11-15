import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Effect, Exit, Scope } from "effect";
import Corestore from "corestore";
import ProtomuxWakeup from "protomux-wakeup";
import crypto from "hypercore-crypto";
import b4a from "b4a";
import { openPersonLog, type PersonLog } from "./PersonLog";
import { foldDevices, personOf, signConsent, signDevice } from "./devices";

// Real stores, joined the way the swarm joins two devices: the point is that
// what one device writes reaches the other, not that our own code agrees with itself.

const dirs: string[] = [];
const stores: Array<{ close: () => Promise<void> }> = [];
let scope: Scope.Closeable;

const PERSON = "a".repeat(64);
const device = async (open: (store: unknown, wakeup: unknown) => Effect.Effect<PersonLog, never, Scope.Scope>) => {
  const dir = mkdtempSync(join(tmpdir(), "collagen-person-"));
  dirs.push(dir);
  const store = new Corestore(dir);
  await store.ready();
  stores.push(store);
  const wakeup = new ProtomuxWakeup();
  const log = await Effect.runPromise(open(store, wakeup).pipe(Effect.provideService(Scope.Scope, scope)));
  return { store, wakeup, log };
};
type Device = Awaited<ReturnType<typeof device>>;
const connect = (one: Device, other: Device) => {
  const out = one.store.replicate(true);
  const back = other.store.replicate(false);
  out.on("error", () => {});
  back.on("error", () => {});
  out.pipe(back).pipe(out);
  one.wakeup.addStream(out);
  other.wakeup.addStream(back);
  return () => void out.destroy();
};
const soon = async (check: () => boolean | Promise<boolean>) => {
  for (let tries = 0; tries < 100; tries++) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
};
const read = (log: PersonLog) => Effect.runPromise(log.read);

/** A first device with its log, and a second one let in to it. */
const pair = async () => {
  const desk = await device((store, wakeup) => openPersonLog(store, PERSON, null, "new", wakeup));
  const laptop = await device((store, wakeup) => openPersonLog(store, PERSON, desk.log.key, { key: desk.log.encryptionKey }, wakeup));
  const disconnect = connect(desk, laptop);
  await Effect.runPromise(desk.log.append({ op: "add-writer", key: laptop.log.writerKey }));
  expect(await soon(() => laptop.log.writable())).toBe(true);
  return { desk, laptop, disconnect };
};

afterEach(async () => {
  await Effect.runPromise(Scope.close(scope, Exit.void));
  for (const store of stores.splice(0)) await store.close().catch(() => {});
  for (const directory of dirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("a person's own log", () => {
  it("a room entered on one device is known on the other, with its keys — and gone from both once left", async () => {
    scope = await Effect.runPromise(Scope.make());
    const { desk, laptop } = await pair();
    await Effect.runPromise(laptop.log.append({ op: "room", room: { id: "room-1", name: "team", logKey: "1".repeat(64), encryptionKey: "2".repeat(64) } }));
    expect(await soon(async () => (await read(desk.log)).rooms.length === 1)).toBe(true);
    expect((await read(desk.log)).rooms).toEqual([{ id: "room-1", name: "team", logKey: "1".repeat(64), encryptionKey: "2".repeat(64) }]);
    await Effect.runPromise(desk.log.append({ op: "leave", id: "room-1" }));
    expect(await soon(async () => (await read(laptop.log)).rooms.length === 0)).toBe(true);
  }, 30_000);

  it("what a device wrote while the other was off reaches it when they next meet", async () => {
    scope = await Effect.runPromise(Scope.make());
    const { desk, laptop, disconnect } = await pair();
    disconnect();
    await Effect.runPromise(laptop.log.append({ op: "room", room: { id: "room-2", name: "later" } }));
    expect((await read(desk.log)).rooms).toEqual([]);
    connect(desk, laptop);
    expect(await soon(async () => (await read(desk.log)).rooms.some((room) => room.id === "room-2"))).toBe(true);
  }, 30_000);

  it("the acts about the person's devices are kept once each, in the order written, for both to fold", async () => {
    scope = await Effect.runPromise(Scope.make());
    const { desk, laptop } = await pair();
    const parent = crypto.keyPair();
    const child = crypto.keyPair();
    const parentKey = b4a.toString(parent.publicKey, "hex");
    const childKey = b4a.toString(child.publicKey, "hex");
    const link = signDevice({ id: "e1", person: parentKey, by: parentKey, at: 1, after: null, act: { kind: "link", device: childKey, name: "laptop", consent: signConsent(parentKey, childKey, child) } }, parent);
    await Effect.runPromise(desk.log.append({ op: "device", entry: link }));
    await Effect.runPromise(desk.log.append({ op: "device", entry: link }));
    expect(await soon(async () => (await read(laptop.log)).devices.length === 1)).toBe(true);
    expect((await read(desk.log)).devices).toHaveLength(1);
    expect(personOf(foldDevices((await read(laptop.log)).devices), childKey)).toBe(parentKey);
  }, 30_000);
});
