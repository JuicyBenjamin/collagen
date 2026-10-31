import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Effect, Exit, Scope } from "effect";
import Corestore from "corestore";
import b4a from "b4a";
import { checkProof, formatInvite, newInvite, openSealed, parseInvite, proveInvite, sealFor } from "./invite";
import { keyPairFromSeed, pubkeyHex, randomSeedHex } from "./identity";
import { openRoomLog, type LogEncryption, type RoomLog } from "./RoomLog";

const LOG = "a".repeat(64);
const person = () => {
  const keyPair = keyPairFromSeed(randomSeedHex());
  return { keyPair, key: pubkeyHex(keyPair.publicKey) };
};

const dirs: string[] = [];
const scopes: Scope.Closeable[] = [];
const stores: Array<{ close: () => Promise<void> }> = [];
const log = async (encryption: LogEncryption = "new"): Promise<RoomLog> => {
  const dir = mkdtempSync(join(tmpdir(), "collagen-invite-"));
  dirs.push(dir);
  const store = new Corestore(dir);
  await store.ready();
  stores.push(store);
  const scope = await Effect.runPromise(Scope.make());
  scopes.push(scope);
  return Effect.runPromise(openRoomLog(store, "room", null, encryption).pipe(Effect.provideService(Scope.Scope, scope)));
};

afterEach(async () => {
  for (const scope of scopes.splice(0)) await Effect.runPromise(Scope.close(scope, Exit.void));
  for (const store of stores.splice(0)) await store.close().catch(() => {});
  for (const directory of dirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("an invite", () => {
  it("is pasted whole and read back: room, log, id and secret", () => {
    const { invite } = newInvite("019a-room", "devnet", LOG);
    const text = formatInvite(invite);
    expect(text.startsWith("devnet-019a-room.")).toBe(true);
    expect(parseInvite(` ${text} `)).toEqual(invite);
    expect(parseInvite("019904c3-1111-7222-8333-444455556666")).toBeNull();
  });

  it("proves out only for the identity, room and invite it was made for", () => {
    const { invite, publicKey } = newInvite("room", "mainnet", LOG);
    const newcomer = person();
    const stranger = person();
    const proof = proveInvite(invite, newcomer.key);
    expect(checkProof("room", invite.id, publicKey, newcomer.key, proof)).toBe(true);
    // overheard, it lets nobody else in, nor into another room, nor with another invite
    expect(checkProof("room", invite.id, publicKey, stranger.key, proof)).toBe(false);
    expect(checkProof("other room", invite.id, publicKey, newcomer.key, proof)).toBe(false);
    expect(checkProof("room", "0".repeat(16), publicKey, newcomer.key, proof)).toBe(false);
    // a secret that is not the invite's does not prove it
    const forged = proveInvite({ ...invite, secret: "b".repeat(64) }, newcomer.key);
    expect(checkProof("room", invite.id, publicKey, newcomer.key, forged)).toBe(false);
  });

  it("is let in once: the first use on the log stands", async () => {
    const room = await log();
    const { invite, publicKey } = newInvite("room", "mainnet", room.key);
    await Effect.runPromise(room.append({ op: "invite", invite: { id: invite.id, publicKey, by: "alice", expires: 10, ts: 1 } }));
    await Effect.runPromise(room.append({ op: "redeemed", id: invite.id, identity: "bob", by: "alice", ts: 2 }));
    await Effect.runPromise(room.append({ op: "redeemed", id: invite.id, identity: "mallory", by: "carol", ts: 3 }));
    const view = await Effect.runPromise(room.read);
    expect(view.invites).toEqual([{ id: invite.id, publicKey, by: "alice", expires: 10, ts: 1, usedBy: "bob" }]);
  });
});

describe("a room's keys", () => {
  it("a new room's log is encrypted; one from before rooms were has no key", async () => {
    expect((await log("new")).encryptionKey).toMatch(/^[0-9a-f]{64}$/);
    expect((await log("none")).encryptionKey).toBeNull();
  });

  it("sealed for a member, only that member opens them", () => {
    const member = person();
    const stranger = person();
    const secret = b4a.from("c".repeat(64), "hex");
    const sealed = sealFor(member.key, secret);
    expect(sealed).not.toBeNull();
    expect(b4a.toString(openSealed(sealed!, member.keyPair)!, "hex")).toBe("c".repeat(64));
    expect(openSealed(sealed!, stranger.keyPair)).toBeNull();
  });

  it("a room moves once: two members moving at once end in the first move", async () => {
    const room = await log("none");
    await Effect.runPromise(room.append({ op: "moved", to: "first", sealed: { alice: "x" }, by: "alice", ts: 1 }));
    await Effect.runPromise(room.append({ op: "moved", to: "second", sealed: { bob: "y" }, by: "bob", ts: 2 }));
    expect((await Effect.runPromise(room.read)).moved).toEqual({ to: "first", sealed: { alice: "x" }, by: "alice" });
  });
});
