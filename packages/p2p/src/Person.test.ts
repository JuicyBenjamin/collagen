import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Effect, Exit, Scope, SubscriptionRef } from "effect";
import Corestore from "corestore";
import ProtomuxWakeup from "protomux-wakeup";
import crypto from "hypercore-crypto";
import b4a from "b4a";
import { makePerson, PersonConfig, type Person, type PersonStored } from "./Person";
import { Swarm, type TopicHooks } from "./Swarm";
import type { Frame } from "./schema";

// Two devices on a network of our own: real stores and real logs, frames
// handed across in memory. The network is the one thing played.

const dirs: string[] = [];
const stores: Array<{ close: () => Promise<void> }> = [];
let scope: Scope.Closeable;

interface Node {
  readonly key: string;
  readonly person: Person;
  readonly saved: () => PersonStored | null;
  readonly hooks: Map<string, TopicHooks>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly store: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly wakeup: any;
}
const nodes = new Map<string, Node>();
const linked = new Set<string>();
const pairKey = (one: string, other: string) => [one, other].sort().join("|");

const node = async (name: string): Promise<Node> => {
  const dir = mkdtempSync(join(tmpdir(), "collagen-person-"));
  dirs.push(dir);
  const store = new Corestore(dir);
  await store.ready();
  stores.push(store);
  const wakeup = new ProtomuxWakeup();
  const keyPair = crypto.keyPair();
  const key = b4a.toString(keyPair.publicKey, "hex");
  const hooks = new Map<string, TopicHooks>();
  let saved: PersonStored | null = null;
  const swarm = {
    identity: { name, profile: name, keyPair, pubkey: key, device: key },
    store,
    wakeup,
    listen: (topicHex: string, topicHooks: TopicHooks) => Effect.sync(() => void hooks.set(topicHex, topicHooks)),
    // on a topic, a node is told of every connected peer that is on it too — as discovery does
    join: (topic: Buffer, topicHooks: TopicHooks) =>
      Effect.suspend(() => {
        const topicHex = b4a.toString(topic, "hex");
        hooks.set(topicHex, topicHooks);
        const there = [...nodes.values()].filter((other) => other.key !== key && linked.has(pairKey(key, other.key)) && other.hooks.has(topicHex));
        return Effect.forEach(there, (other) => Effect.all([topicHooks.greet(other.key), other.hooks.get(topicHex)!.greet(key)]), { discard: true }).pipe(Effect.as(topicHex));
      }),
    write: (to: string, topicHex: string, frame: Frame) =>
      Effect.suspend(() => {
        const there = nodes.get(to);
        const heard = linked.has(pairKey(key, to)) ? there?.hooks.get(topicHex) : undefined;
        return heard ? heard.onFrame(key, frame).pipe(Effect.forkDetach, Effect.asVoid) : Effect.void;
      }),
  };
  const person = await Effect.runPromise(
    makePerson.pipe(
      Effect.provideService(Swarm, swarm as never),
      Effect.provideService(PersonConfig, { net: "devnet", stored: null, save: (stored) => Effect.sync(() => void (saved = stored)), deviceName: name }),
      Effect.provideService(Scope.Scope, scope),
    ),
  );
  const made = { key, person, saved: () => saved, hooks, store, wakeup };
  nodes.set(key, made);
  return made;
};
const connect = (one: Node, other: Node) => {
  linked.add(pairKey(one.key, other.key));
  const out = one.store.replicate(true);
  const back = other.store.replicate(false);
  out.on("error", () => {});
  back.on("error", () => {});
  out.pipe(back).pipe(out);
  one.wakeup.addStream(out);
  other.wakeup.addStream(back);
  for (const [topicHex, mine] of one.hooks) {
    const theirs = other.hooks.get(topicHex);
    if (theirs) void Effect.runPromise(Effect.all([mine.greet(other.key), theirs.greet(one.key)]));
  }
};
const stateOf = (of: Node) => Effect.runPromise(SubscriptionRef.get(of.person.state));
const soon = async (check: () => Promise<boolean>) => {
  for (let tries = 0; tries < 100; tries++) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
};
const names = async (of: Node) => (await stateOf(of)).devices.map((device) => device.name).sort();

afterEach(async () => {
  await Effect.runPromise(Scope.close(scope, Exit.void));
  for (const store of stores.splice(0)) await store.close().catch(() => {});
  for (const directory of dirs.splice(0)) rmSync(directory, { recursive: true, force: true });
  nodes.clear();
  linked.clear();
});

describe("two devices becoming one person", () => {
  it("takes both sides: a share alone, or a take alone, changes nothing", async () => {
    scope = await Effect.runPromise(Scope.make());
    const desk = await node("desk");
    const laptop = await node("laptop");
    const stranger = await node("stranger");
    connect(desk, laptop);
    connect(desk, stranger);
    expect(await Effect.runPromise(desk.person.share(laptop.key))).toBe("offered");
    // someone the parent did not name asks: not heard
    expect(await Effect.runPromise(stranger.person.take(desk.key))).toBe("asked");
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect((await stateOf(desk)).devices).toHaveLength(1);
    expect((await stateOf(laptop)).person).toBe(laptop.key);
    expect((await stateOf(stranger)).person).toBe(stranger.key);
  }, 30_000);

  it("once both are told, they are one person with two devices — whichever was told first — and both can write", async () => {
    scope = await Effect.runPromise(Scope.make());
    const desk = await node("desk");
    const laptop = await node("laptop");
    connect(desk, laptop);
    expect(await Effect.runPromise(laptop.person.take(desk.key))).toBe("asked");
    expect(await Effect.runPromise(desk.person.share(laptop.key))).toBe("offered");
    expect(await soon(async () => (await stateOf(laptop)).person === desk.key && (await stateOf(laptop)).devices.length === 2)).toBe(true);
    expect((await stateOf(desk)).parent).toBe(desk.key);
    expect(laptop.saved()?.person).toBe(desk.key);
    // the laptop names itself: it can write to the log they share, and the desk sees it
    expect(await soon(async () => (await Effect.runPromise(laptop.person.name(laptop.key, "work laptop"))) === "named")).toBe(true);
    expect(await soon(async () => (await names(desk)).includes("work laptop"))).toBe(true);
  }, 60_000);

  it("only the parent puts a device out or hands its part on; after handing on, the other device is the parent", async () => {
    scope = await Effect.runPromise(Scope.make());
    const desk = await node("desk");
    const laptop = await node("laptop");
    connect(desk, laptop);
    await Effect.runPromise(laptop.person.take(desk.key));
    await Effect.runPromise(desk.person.share(laptop.key));
    expect(await soon(async () => (await stateOf(laptop)).devices.length === 2)).toBe(true);
    expect(await Effect.runPromise(laptop.person.putOut(desk.key))).toBe("is-parent");
    expect(await Effect.runPromise(laptop.person.handOver(laptop.key))).toBe("not-parent");
    expect(await Effect.runPromise(desk.person.handOver(laptop.key))).toBe("handed");
    expect(await soon(async () => (await stateOf(laptop)).parent === laptop.key)).toBe(true);
    expect(await soon(async () => (await Effect.runPromise(laptop.person.putOut(desk.key))) === "out")).toBe(true);
    expect(await soon(async () => (await stateOf(desk)).devices.length === 1)).toBe(true);
    expect((await stateOf(desk)).devices[0]!.key).toBe(laptop.key);
  }, 60_000);

  it("a device code makes a machine with no room in common one of the person's devices — once, and only with the code", async () => {
    scope = await Effect.runPromise(Scope.make());
    const desk = await node("desk");
    const laptop = await node("laptop");
    const second = await node("second");
    const guesser = await node("guesser");
    const made = await Effect.runPromise(desk.person.makeCode());
    if (typeof made === "string") throw new Error(made);
    // not a code, and a code whose secret was guessed: nothing
    expect(await Effect.runPromise(guesser.person.useCode("hello"))).toBe("not-a-code");
    expect(await Effect.runPromise(guesser.person.useCode(`${made.code.slice(0, -4)}0000`))).toBe("asked");
    connect(desk, guesser);
    // the laptop enters the code, and the two find each other
    expect(await Effect.runPromise(laptop.person.useCode(made.code))).toBe("asked");
    connect(desk, laptop);
    expect(await soon(async () => (await stateOf(laptop)).person === desk.key && (await stateOf(laptop)).devices.length === 2)).toBe(true);
    expect(laptop.saved()?.person).toBe(desk.key);
    expect((await stateOf(guesser)).person).toBe(guesser.key);
    // the same code again, on another machine: it let one device in
    expect(await Effect.runPromise(second.person.useCode(made.code))).toBe("asked");
    connect(desk, second);
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect((await stateOf(second)).person).toBe(second.key);
    expect((await stateOf(desk)).devices).toHaveLength(2);
  }, 60_000);
});
