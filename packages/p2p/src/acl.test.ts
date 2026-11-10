import { describe, expect, it } from "vitest";
import crypto from "hypercore-crypto";
import b4a from "b4a";
import { foldAcl, permitted, signAcl, type AclAct, type AclEntry } from "./acl";
import { signConsent, signDevice } from "./devices";

const ROOM = "room-1";
const person = () => {
  const pair = crypto.keyPair();
  return { key: b4a.toString(pair.publicKey, "hex"), pair };
};
const owner = person();
const mod = person();
const member = person();
const newcomer = person();

let clock = 0;
const act = (who: ReturnType<typeof person>, what: AclAct, room = ROOM): AclEntry => signAcl(room, { id: `e${++clock}`, by: who.key, at: clock, act: what }, who.pair);

const moderator = { kind: "role", role: { id: "mod", name: "moderator", rank: 10, permissions: ["approve", "remove", "manage-roles"] } } as const;
// a room where only moderators let people in: everyone may invite, nobody else approves
const strict = { kind: "role", role: { id: "everyone", name: "everyone", rank: 0, permissions: ["invite"] } } as const;
const base = [act(owner, { kind: "found" }), act(owner, moderator), act(owner, strict), act(owner, { kind: "grant", identity: mod.key, roles: ["mod"] })];

describe("who may do what in a room", () => {
  it("is founded once: the first founder is the owner", () => {
    const acl = foldAcl(ROOM, [act(owner, { kind: "found" }), act(member, { kind: "found" })]);
    expect(acl.owner).toBe(owner.key);
  });

  it("counts nothing forged, or signed for another room", () => {
    const forged = { ...act(member, { kind: "found" }), by: owner.key };
    expect(foldAcl(ROOM, [forged]).owner).toBe(null);
    expect(foldAcl(ROOM, [act(owner, { kind: "found" }, "another-room")]).owner).toBe(null);
  });

  it("lets everyone invite and let in, in a new room", () => {
    const acl = foldAcl(ROOM, [act(owner, { kind: "found" })]);
    expect(permitted(acl, member.key, "invite")).toBe(true);
    expect(permitted(acl, member.key, "approve")).toBe(true);
    expect(permitted(acl, member.key, "remove")).toBe(false);
  });

  it("keeps a newcomer waiting until someone allowed lets them in", () => {
    const heard = act(member, { kind: "request", identity: newcomer.key, name: "Nina", inviteId: "i1" });
    const waiting = foldAcl(ROOM, [...base, heard]);
    expect(waiting.waiting.has(newcomer.key)).toBe(true);
    // a member without 'approve' cannot let them in; the moderator can
    const byMember = foldAcl(ROOM, [...base, heard, act(member, { kind: "admit", identity: newcomer.key })]);
    expect(byMember.admitted.has(newcomer.key)).toBe(false);
    const byMod = foldAcl(ROOM, [...base, heard, act(mod, { kind: "admit", identity: newcomer.key })]);
    expect(byMod.admitted.has(newcomer.key)).toBe(true);
    expect(byMod.waiting.has(newcomer.key)).toBe(false);
  });

  it("only acts on those ranked below: a moderator cannot remove the owner or promote themselves", () => {
    const acl = foldAcl(ROOM, [
      ...base,
      act(mod, { kind: "remove", identity: owner.key }),
      act(mod, { kind: "role", role: { id: "mod", name: "moderator", rank: 99, permissions: ["approve", "remove", "manage-roles", "invite"] } }),
      act(mod, { kind: "remove", identity: member.key }),
    ]);
    expect(acl.removed.has(owner.key)).toBe(false);
    expect(acl.roles.get("mod")?.rank).toBe(10);
    expect(acl.removed.has(member.key)).toBe(true);
    // taken out: no permission is theirs any more, not even everyone's
    expect(permitted(acl, member.key, "invite")).toBe(false);
  });

  it("decides by log order: a role given after an act does not make that act count", () => {
    const early = act(member, { kind: "remove", identity: newcomer.key });
    const acl = foldAcl(ROOM, [...base, early, act(owner, { kind: "grant", identity: member.key, roles: ["mod"] })]);
    expect(acl.removed.has(newcomer.key)).toBe(false);
  });

  it("a person's device signs as them — from when it was taken in, until it is put out", () => {
    const laptop = person();
    const link = signDevice({ id: "d1", person: owner.key, by: owner.key, at: 1, after: null, act: { kind: "link", device: laptop.key, name: "laptop", consent: signConsent(owner.key, laptop.key, laptop.pair) } }, owner.pair);
    const unlink = signDevice({ id: "d2", person: owner.key, by: owner.key, at: 2, after: "d1", act: { kind: "unlink", device: laptop.key } }, owner.pair);
    const found = act(owner, { kind: "found" });
    const letIn = act(laptop, { kind: "admit", identity: newcomer.key });
    const takeOut = act(laptop, { kind: "remove", identity: member.key });
    // before the laptop is the owner's, it is a stranger: its word removes nobody
    expect(foldAcl(ROOM, [found, takeOut, link]).removed.has(member.key)).toBe(false);
    // as the owner's device it holds what the owner holds
    const linked = foldAcl(ROOM, [found, link, takeOut]);
    expect(linked.removed.get(member.key)?.by).toBe(owner.key);
    // what it did while it was theirs stands after it is put out; what it signs after does not
    const after = foldAcl(ROOM, [found, link, letIn, unlink, takeOut]);
    expect(after.admitted.has(newcomer.key)).toBe(true);
    expect(after.removed.has(member.key)).toBe(false);
  });
});
