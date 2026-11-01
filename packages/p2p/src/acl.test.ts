import { describe, expect, it } from "vitest";
import crypto from "hypercore-crypto";
import b4a from "b4a";
import { foldAcl, permitted, signAcl, type AclAct, type AclEntry } from "./acl";

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
});
