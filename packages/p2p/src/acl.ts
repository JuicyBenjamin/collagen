import crypto from "hypercore-crypto";
import b4a from "b4a";
import { Schema } from "effect";

// Who may do what in a room. Collagen defines the permissions; each room
// defines its own roles — a name, a rank, the permissions it holds — as on
// Discord. Every act about roles, joining and removal is an entry signed by
// the identity that made it, so any peer can tell who made it whichever
// writer appended it; the acts fold in log order, and one counts only when
// its signer held the permission for it at that point. The room's creator is
// its owner: every permission, outranking every role.

/** What a role can let its holders do. */
export const PERMISSIONS = ["invite", "approve", "remove", "manage-roles"] as const;
export const Permission = Schema.Literals(PERMISSIONS);
export type Permission = typeof Permission.Type;

/** A role the room defined. A higher rank stands above a lower one: only a
 *  holder of a higher rank may give, change or take it, or act on its holders. */
export const RoomRole = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  rank: Schema.Finite,
  permissions: Schema.Array(Permission),
});
export type RoomRole = typeof RoomRole.Type;

/** The role every member holds. A new room lets everyone invite and let in. */
export const EVERYONE: RoomRole = { id: "everyone", name: "everyone", rank: 0, permissions: ["invite", "approve"] };

export const AclAct = Schema.Union([
  /** the room's creator, its owner: the first of these in the log stands */
  Schema.Struct({ kind: Schema.Literal("found") }),
  /** a role made or changed (the same id) */
  Schema.Struct({ kind: Schema.Literal("role"), role: RoomRole }),
  /** a role taken away */
  Schema.Struct({ kind: Schema.Literal("unrole"), roleId: Schema.String }),
  /** a member's roles, as they now stand */
  Schema.Struct({ kind: Schema.Literal("grant"), identity: Schema.String, roles: Schema.Array(Schema.String) }),
  /** someone with an invite who must wait to be let in; written by the member they asked */
  Schema.Struct({ kind: Schema.Literal("request"), identity: Schema.String, name: Schema.String, inviteId: Schema.String }),
  /** let in */
  Schema.Struct({ kind: Schema.Literal("admit"), identity: Schema.String }),
  /** not let in */
  Schema.Struct({ kind: Schema.Literal("decline"), identity: Schema.String, reason: Schema.optional(Schema.String) }),
  /** taken out of the room: nothing more is sent to them, and the room moves to a key they are not given */
  Schema.Struct({ kind: Schema.Literal("remove"), identity: Schema.String, reason: Schema.optional(Schema.String) }),
]);
export type AclAct = typeof AclAct.Type;

/** One signed act. */
export const AclEntry = Schema.Struct({
  id: Schema.String,
  /** the identity that made it, and signed it */
  by: Schema.String,
  at: Schema.Finite,
  act: AclAct,
  sig: Schema.String,
});
export type AclEntry = typeof AclEntry.Type;

/** A value as one string, its keys sorted: the same whatever order a decode gave them. */
const canonical = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(",")}]`
    : value !== null && typeof value === "object"
      ? `{${Object.keys(value)
          .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
          .join(",")}}`
      : JSON.stringify(value);

/** What is signed: the act, its id, who and when, bound to the room — an act cannot be replayed in another. */
const signed = (roomName: string, entry: Omit<AclEntry, "sig">) => b4a.from(`collagen-acl|${roomName}|${canonical({ id: entry.id, by: entry.by, at: entry.at, act: entry.act })}`);

/** Sign an act with the identity's key pair. */
export const signAcl = (roomName: string, entry: Omit<AclEntry, "sig">, keyPair: { readonly secretKey: Uint8Array }): AclEntry => ({
  ...entry,
  sig: b4a.toString(crypto.sign(signed(roomName, entry), keyPair.secretKey), "hex"),
});

/** Whether an act was signed by the identity it names. */
export const verifyAcl = (roomName: string, entry: AclEntry): boolean => {
  if (!/^[0-9a-f]{128}$/.test(entry.sig) || !/^[0-9a-f]{64}$/.test(entry.by)) return false;
  try {
    return crypto.verify(signed(roomName, entry), b4a.from(entry.sig, "hex"), b4a.from(entry.by, "hex"));
  } catch {
    return false;
  }
};

/** Who may do what in a room, as its acts stand. */
export interface Acl {
  readonly owner: string | null;
  /** every role, everyone's included */
  readonly roles: ReadonlyMap<string, RoomRole>;
  /** each member's roles, besides everyone's */
  readonly held: ReadonlyMap<string, ReadonlyArray<string>>;
  /** let in by someone allowed to */
  readonly admitted: ReadonlySet<string>;
  /** waiting to be let in: their name, the invite they came with, who heard them */
  readonly waiting: ReadonlyMap<string, { readonly name: string; readonly inviteId: string; readonly at: number }>;
  readonly declined: ReadonlyMap<string, { readonly by: string; readonly reason?: string; readonly at: number }>;
  readonly removed: ReadonlyMap<string, { readonly by: string; readonly reason?: string; readonly at: number }>;
}

export const EMPTY_ACL: Acl = { owner: null, roles: new Map([[EVERYONE.id, EVERYONE]]), held: new Map(), admitted: new Set(), waiting: new Map(), declined: new Map(), removed: new Map() };

/** Whether `identity` holds `permission`: the owner holds them all; anyone else through their roles and everyone's. */
export const permitted = (acl: Acl, identity: string, permission: Permission): boolean =>
  identity === acl.owner ||
  (!acl.removed.has(identity) && [EVERYONE.id, ...(acl.held.get(identity) ?? [])].some((id) => acl.roles.get(id)?.permissions.includes(permission) ?? false));

/** How high `identity` stands: the owner above every role; anyone else at their highest role. */
export const rankOf = (acl: Acl, identity: string): number =>
  identity === acl.owner ? Number.POSITIVE_INFINITY : Math.max(0, ...(acl.held.get(identity) ?? []).map((id) => acl.roles.get(id)?.rank ?? 0));

/** The room's acts folded in log order: each counts only when it is signed by
 *  the identity it names, and that identity held the permission for it at
 *  that point. An act that does not count changes nothing. */
export const foldAcl = (roomName: string, entries: ReadonlyArray<AclEntry>): Acl => {
  let owner: string | null = null;
  const roles = new Map<string, RoomRole>([[EVERYONE.id, EVERYONE]]);
  const held = new Map<string, ReadonlyArray<string>>();
  const admitted = new Set<string>();
  const waiting = new Map<string, { name: string; inviteId: string; at: number }>();
  const declined = new Map<string, { by: string; reason?: string; at: number }>();
  const removed = new Map<string, { by: string; reason?: string; at: number }>();
  const seen = new Set<string>();
  const now = (): Acl => ({ owner, roles, held, admitted, waiting, declined, removed });
  for (const entry of entries) {
    if (seen.has(entry.id) || !verifyAcl(roomName, entry)) continue;
    seen.add(entry.id);
    const by = entry.by;
    const act = entry.act;
    const may = (permission: Permission) => permitted(now(), by, permission);
    const above = (rank: number) => rank < rankOf(now(), by);
    switch (act.kind) {
      case "found":
        if (owner === null) owner = by;
        break;
      case "role": {
        const before = roles.get(act.role.id);
        // everyone's role stands lowest; a role is made or changed only below your own rank
        const rank = act.role.id === EVERYONE.id ? 0 : act.role.rank;
        if (may("manage-roles") && above(rank) && (!before || above(before.rank))) roles.set(act.role.id, { ...act.role, rank });
        break;
      }
      case "unrole": {
        const before = roles.get(act.roleId);
        if (before && act.roleId !== EVERYONE.id && may("manage-roles") && above(before.rank)) {
          roles.delete(act.roleId);
          for (const [identity, ids] of held) held.set(identity, ids.filter((id) => id !== act.roleId));
        }
        break;
      }
      case "grant": {
        if (act.identity === owner || !may("manage-roles") || !above(rankOf(now(), act.identity))) break;
        const changed = new Set([...(held.get(act.identity) ?? []), ...act.roles]);
        // every role given or taken stands below the giver
        if ([...changed].every((id) => roles.has(id) && above(roles.get(id)!.rank))) held.set(act.identity, act.roles.filter((id) => roles.has(id) && id !== EVERYONE.id));
        break;
      }
      case "request":
        // any member hears a newcomer out; it means nothing for someone already in or out
        if (!admitted.has(act.identity) && !removed.has(act.identity) && !waiting.has(act.identity)) waiting.set(act.identity, { name: act.name, inviteId: act.inviteId, at: entry.at });
        break;
      case "admit":
        if (may("approve") && !removed.has(act.identity)) {
          admitted.add(act.identity);
          waiting.delete(act.identity);
          declined.delete(act.identity);
        }
        break;
      case "decline":
        if (may("approve") && !admitted.has(act.identity)) {
          waiting.delete(act.identity);
          declined.set(act.identity, { by, ...(act.reason ? { reason: act.reason } : {}), at: entry.at });
        }
        break;
      case "remove":
        if (act.identity !== owner && may("remove") && above(rankOf(now(), act.identity))) {
          removed.set(act.identity, { by, ...(act.reason ? { reason: act.reason } : {}), at: entry.at });
          admitted.delete(act.identity);
          waiting.delete(act.identity);
          held.delete(act.identity);
        }
        break;
    }
  }
  return now();
};
