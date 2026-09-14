import { Option, Schema } from "effect";
import { Ticket } from "./ticket";

// Records written by an earlier protocol version, and how each becomes the
// current shape. This is a MIGRATION, not a compatibility path: the app reads
// the current shape only; an old record is rewritten into it once — on the
// log, for everyone — and what cannot be rewritten is evicted. We know every
// shape we have ever written, so "cannot" should be rare.
//
// Adding a field to a record: add its default here, in the one function that
// knows the old shape, and bump PROTOCOL_VERSION. Nothing else learns the old
// shape.

/** A ticket as protocols 2 and 3 wrote it: no `structureAt` (4 added it;
 *  `closed`, `from`, `whenClosed` were optional from the start, and the
 *  older kinds and statuses are subsets of today's). */
const LegacyTicket = Schema.Struct({
  ...Ticket.fields,
  structureAt: Schema.optional(Schema.Finite),
});

const current = Schema.decodeUnknownOption(Ticket);
const legacy = Schema.decodeUnknownOption(LegacyTicket);

export interface Read<A> {
  readonly value: A;
  /** true when the record had to be rewritten into the current shape */
  readonly migrated: boolean;
}

/** Read a ticket from a view row or a log entry: the current shape as it is,
 *  an older shape rewritten — the author's structure clock starts at the
 *  ticket's last change, the only time it had — or nothing. */
export const readTicket = (raw: unknown): Read<Ticket> | null => {
  const now = current(raw);
  if (Option.isSome(now)) return { value: now.value, migrated: false };
  const old = legacy(raw);
  if (Option.isNone(old)) return null;
  const t = old.value;
  return { value: { ...t, structureAt: t.structureAt ?? t.updatedAt }, migrated: true };
};

/** The kinds of view row a migration exists for, by key prefix. */
export const migrateRow = (prefix: string, raw: unknown): Read<unknown> | null => (prefix === "ticket" ? readTicket(raw) : null);

/** A log entry we could not decode: the migrated entry, when its record has
 *  an older shape we know. */
export const migrateOp = (raw: unknown): { readonly op: "ticket"; readonly ticket: Ticket } | null => {
  if (typeof raw !== "object" || raw === null) return null;
  const v = raw as Record<string, unknown>;
  if (v.op !== "ticket") return null;
  const t = readTicket(v.ticket);
  return t ? { op: "ticket", ticket: t.value } : null;
};
