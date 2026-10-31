import { createHash } from "node:crypto";
import { Clock, Effect, Option, Queue, Schema, Stream } from "effect";
import Autobase from "autobase";
import Hyperbee from "hyperbee";
import b4a from "b4a";
import { LogAppendFailed } from "./errors";
import { Attachment, EVICTABLE, InviteRecord, LogOp, Member, PROTOCOL_VERSION, RoomMessage } from "./schema";
import { ReviewComment, strictlySupersedes, supersedes } from "./review";
import { ReviewContext } from "./review";
import { Ticket, contributes, mergeTicket } from "./ticket";
import { migrateOp, migrateRow, readTicket } from "./migrate";

/** The room as derived from its log. Read whole — rooms are small. */
export interface LogView {
  readonly tickets: ReadonlyArray<Ticket>;
  readonly name: { readonly name: string; readonly ts: number } | null;
  readonly members: ReadonlyArray<Member>;
  /** Every message in the room, in log order, with its position. */
  readonly messages: ReadonlyArray<{ readonly seq: number; readonly message: RoomMessage }>;
  /** Transcripts attached to tickets — references; the files stay with their holders. */
  readonly attachments: ReadonlyArray<Attachment>;
  /** comments on reviews' code, in the order their keys sort (ticket, then id) */
  readonly comments: ReadonlyArray<ReviewComment>;
  /** The why behind each review ticket, one per ticket. */
  readonly reviews: ReadonlyArray<ReviewContext>;
  /** Entries written by a NEWER build than this one, kept raw and unapplied:
   *  records this build cannot read until it updates. A ticket among them is
   *  shown on the overview as `unknown`; the rest are counted. Once this
   *  build can read one, `rewriteMigrated` replays it and the row goes. */
  readonly unseen: ReadonlyArray<Unseen>;
  /** Invites made in this room, each with who it let in once used. */
  readonly invites: ReadonlyArray<InviteRecord & { readonly usedBy: string | null }>;
  /** Where the room moved to, once one member opened its encrypted log: the
   *  new log's key and its encryption key sealed for each member's identity. */
  readonly moved: { readonly to: string; readonly sealed: Readonly<Record<string, string>>; readonly by: string } | null;
}

/** How a room's log is read: its own encryption key, a new log made
 *  encrypted, or a log from before rooms were encrypted. */
export type LogEncryption = { readonly key: string } | "new" | "none";

export interface Unseen {
  /** The view key the entry claims (`ticket/<id>`, `review/<id>`, …), or `op/<n>` when it claims none. */
  readonly key: string;
  readonly protocol: number;
}

export interface RoomLog {
  /** The log's key: what a joiner needs to open it (travels in the greet). */
  readonly key: string;
  /** Our writer core's key: what a member appends to admit us. */
  readonly writerKey: string;
  /** The key that reads it, null for a log from before rooms were encrypted. */
  readonly encryptionKey: string | null;
  readonly writable: () => boolean;
  /** Fails (LogAppendFailed, "Not writable") until admitted. Resolves once the view reflects the entry. */
  readonly append: (op: LogOp) => Effect.Effect<void, LogAppendFailed>;
  /** Several entries as one batch, the same way. */
  readonly appendAll: (ops: ReadonlyArray<LogOp>) => Effect.Effect<void, LogAppendFailed>;
  readonly read: Effect.Effect<LogView>;
  /** Take the rows no build of ours can read off the room, for every member
   *  (one `evict` entry on the log). Returns how many went. */
  readonly evictStale: Effect.Effect<number>;
  /** Older records we could read, written back in the current shape. */
  readonly rewriteMigrated: Effect.Effect<number>;
  /** Our own tickets and whys the view lost (an eviction before a migration
   *  existed, or by a build that could not read them), put back. null when it could not run yet (not writable) — try again later. */
  readonly restoreOwn: Effect.Effect<number | null>;
  /** Fires after the view changed or our writer status did. */
  readonly changes: Stream.Stream<void>;
}

/** How long to wait for Autobase to fold our own entry into the view before
 *  carrying on without it. Long enough to be the normal path, short enough
 *  that nothing user-facing hangs on a peer that went quiet. */
const UPDATE_PATIENCE = "5 seconds";

const decodeOp = Schema.decodeUnknownOption(LogOp);

/** The protocol an entry says it was written under, when it says. */
const wireProtocol = (value: unknown): number | null => {
  if (typeof value !== "object" || value === null) return null;
  const protocol = (value as Record<string, unknown>).protocol;
  return typeof protocol === "string" && /^\d+$/.test(protocol) ? Number(protocol) : null;
};
/** The protocol this build reads. A test lowers it to play an older build,
 *  then raises it to play the update — nothing in the app touches it. */
export const protocolForTests = { ours: Number(PROTOCOL_VERSION) };
const UNSEEN = "unseen/";
/** Where a newer build's entry is kept raw: under the key it claims (or `op`
 *  when it claims none) and a HASH OF ITS CONTENT — so the row key names the
 *  entry itself, the same on every peer, and a replay that carries it can
 *  never retire a different entry that happened to land at the same local
 *  position. Arrival order is kept in the row (`n`) and restored on read. */
/** Key-sorted JSON, so two encodings of one entry hash the same. */
const canonical = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(",")}]`
    : typeof value === "object" && value !== null
      ? `{${Object.keys(value as Record<string, unknown>)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
          .join(",")}}`
      : JSON.stringify(value);
/** The entry's identity: its content, protocol included, without the one
 *  field a replay adds (`replays`) — so the raw entry a peer kept and the
 *  replay of it hash alike (a replay keeps the entry's own protocol), while
 *  the same body written under two protocols is two entries: the same wire
 *  shape can mean different things in different versions, and a decodable
 *  copy must never be swallowed by one that is not. The full digest — this
 *  is what data lives on. */
const entryHash = (value: unknown): string => {
  const { replays: _r, ...content } = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  return createHash("sha256").update(canonical(content)).digest("hex");
};
const unseenKey = (claimed: string | null, value: unknown) => `${UNSEEN}${claimed ?? "op"}/${entryHash(value)}`;
/** The claimed key an unseen row was filed under: `unseen/ticket/t1/9f2c…` → `ticket/t1`. */
const unseenClaim = (rowKey: string): string => rowKey.slice(UNSEEN.length).replace(/\/[0-9a-f]{64}$/, "");
const MSG_KEY = (seq: number) => `msg/${String(seq).padStart(12, "0")}`;

/** The view key an entry we CANNOT read would have written, when the entry is
 *  still shaped enough to say. One protocol version at a time: an entry from
 *  a build that speaks another one is not accommodated, and it does not get
 *  to sit in the room half-applied either — the row it claims is deleted, so
 *  the record is gone rather than stale. */
const claimedKey = (value: unknown): string | null => {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const field = (nested: unknown, property: string): string | null => {
    const got = typeof nested === "object" && nested !== null ? (nested as Record<string, unknown>)[property] : undefined;
    return typeof got === "string" ? got : null;
  };
  if (record.op === "ticket") {
    const id = field(record.ticket, "id");
    return id ? `ticket/${id}` : null;
  }
  if (record.op === "review") {
    const id = field(record.review, "ticketId");
    return id ? `review/${id}` : null;
  }
  if (record.op === "attachment") {
    const ticketId = field(record.attachment, "ticketId");
    const id = field(record.attachment, "id");
    return ticketId && id ? `attachment/${ticketId}/${id}` : null;
  }
  if (record.op === "comment") {
    const ticketId = field(record.comment, "ticketId");
    const id = field(record.comment, "id");
    return ticketId && id ? `comment/${ticketId}/${id}` : null;
  }
  return null;
};

/** The one place log entries become room state. Runs on every member with
 *  the same inputs in the same order, so it must be a pure function of
 *  (view, entries): reads and writes the Hyperbee view, nothing else.
 *  Malformed entries are skipped — a bad writer can't wedge the room. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function apply(nodes: ReadonlyArray<{ value: unknown }>, view: any, host: any): Promise<void> {
  for (const node of nodes) {
    // an entry from a NEWER build is not ours to judge: leave it unapplied and
    // count it, so the room loses nothing while this side has not updated
    const wire = wireProtocol(node.value);
    if (wire !== null && wire > protocolForTests.ours) {
      const count = ((await view.get("state/unseen"))?.value ?? 0) as number;
      await view.put("state/unseen", count + 1);
      // the same entry seen twice (two writers replaying it) is one row
      const key = unseenKey(claimedKey(node.value), node.value);
      if (!(await view.get(key))) await view.put(key, { protocol: wire, raw: node.value, n: count });
      continue;
    }
    // an entry from an older protocol is rewritten into the current shape when
    // we know the old one (migrate.ts); only what nobody can read is ejected
    const logOp = Option.getOrUndefined(decodeOp(node.value)) ?? migrateOp(node.value) ?? undefined;
    if (!logOp) {
      // unreadable here: eject the row it claims instead of leaving a stale one
      const key = claimedKey(node.value);
      if (key) await view.del(key);
      continue;
    }
    switch (logOp.op) {
      case "add-writer":
        await host.addWriter(b4a.from(logOp.key, "hex"), { indexer: true });
        break;
      case "member": {
        const current = await view.get(`member/${logOp.key}`);
        if (!current || logOp.ts >= current.value.ts) await view.put(`member/${logOp.key}`, { key: logOp.key, name: logOp.name, ts: logOp.ts });
        break;
      }
      case "ticket": {
        // the row we merge into may itself be an older shape: migrate it first
        const current = await view.get(`ticket/${logOp.ticket.id}`);
        const local = current ? readTicket(current.value)?.value : undefined;
        await view.put(`ticket/${logOp.ticket.id}`, local ? mergeTicket(local, logOp.ticket) : logOp.ticket);
        break;
      }
      case "rename": {
        const current = await view.get("meta/name");
        if (!current || logOp.ts > current.value.ts) await view.put("meta/name", { name: logOp.name, ts: logOp.ts });
        break;
      }
      case "msg": {
        // one copy per id: a message replayed after an update, or re-appended
        // by two peers replaying the same entry, lands once
        if (await view.get(`msgid/${logOp.msg.id}`)) break;
        const count = (await view.get("state/msgs"))?.value ?? 0;
        await view.put(MSG_KEY(count), logOp.msg);
        await view.put("state/msgs", count + 1);
        await view.put(`msgid/${logOp.msg.id}`, count);
        break;
      }
      case "comment": {
        // written once by its author: the first write of an id stands
        const key = `comment/${logOp.comment.ticketId}/${logOp.comment.id}`;
        if (!(await view.get(key))) await view.put(key, logOp.comment);
        break;
      }
      case "attachment": {
        // first write wins: an attachment is a fact about a file someone holds
        const current = await view.get(`attachment/${logOp.attachment.ticketId}/${logOp.attachment.id}`);
        if (!current) await view.put(`attachment/${logOp.attachment.ticketId}/${logOp.attachment.id}`, logOp.attachment);
        break;
      }
      case "review": {
        // one review per ticket, written by its author alone: later ts wins
        const current = await view.get(`review/${logOp.review.ticketId}`);
        if (!current || supersedes(logOp.review, current.value as ReviewContext)) await view.put(`review/${logOp.review.ticketId}`, logOp.review);
        break;
      }
      case "invite": {
        // first write wins: an invite is the public half of a secret handed out once
        const key = `invite/${logOp.invite.id}`;
        if (!(await view.get(key))) await view.put(key, logOp.invite);
        break;
      }
      case "redeemed": {
        // first use wins: an invite lets one person in, whoever got there first in log order
        const key = `redeemed/${logOp.id}`;
        if (!(await view.get(key))) await view.put(key, { id: logOp.id, identity: logOp.identity, by: logOp.by, ts: logOp.ts });
        break;
      }
      case "moved":
        // the first move stands: two members moving at once end in one room
        if (!(await view.get("meta/moved"))) await view.put("meta/moved", { to: logOp.to, sealed: logOp.sealed, by: logOp.by, ts: logOp.ts });
        break;
      case "evict":
        // the migration, replayed on every member: drop what it names
        for (const key of logOp.keys) if (EVICTABLE.test(key)) await view.del(key);
        break;
      default: {
        // a LogOp with no case here is a COMPILE error: an entry every member
        // silently ignores is the worst kind of nothing
        const unhandled: never = logOp;
        void unhandled;
        break;
      }
    }
    // a replayed entry names the raw row it came from: that row, and only
    // that row, is done — and only now that the entry has applied. The marker
    // is not trusted: the row it may retire is recomputed from THIS entry's
    // claimed key and content, and must match exactly, so no entry can carry
    // another entry's key and erase what a peer kept.
    const replays = (node.value as { replays?: unknown }).replays;
    if (typeof replays === "string" && replays === unseenKey(claimedKey(node.value), node.value)) await view.del(replays);
  }
}

/** Where in the Corestore a room's log lives. The room's own namespace holds
 *  the writer core we made for it; if that core already belongs to ANOTHER
 *  base (we started a log of our own before adopting the room's, or the room
 *  moved to a new encrypted log), the other log gets a namespace of its own —
 *  reusing a writer core across bases corrupts both. A log we create while
 *  the room's namespace is taken (moving the room) lives in `<room>/encrypted`,
 *  where reopening it by its key finds it again. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const namespaceFor = async (store: any, roomName: string, bootstrap: string | null): Promise<any> => {
  const primary = store.namespace(roomName);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const localOf = async (namespace: any) => {
    const local = Autobase.getLocalCore(namespace, {});
    await local.ready();
    const { referrer } = await Autobase.getUserData(local);
    const facts = { key: local.key as Uint8Array, length: local.length as number, referrer: (referrer ?? null) as Uint8Array | null };
    await local.close();
    return facts;
  };
  const room = await localOf(primary);
  if (bootstrap === null) return room.length === 0 && room.referrer === null ? primary : store.namespace(`${roomName}/encrypted`);
  const wanted = b4a.from(bootstrap, "hex");
  if (room.referrer === null ? room.length === 0 || b4a.equals(room.key, wanted) : b4a.equals(room.referrer, wanted)) return primary;
  const moved = store.namespace(`${roomName}/encrypted`);
  const ours = await localOf(moved);
  if (b4a.equals(ours.key, wanted) || (ours.referrer !== null && b4a.equals(ours.referrer, wanted))) return moved;
  return store.namespace(`${roomName}/${bootstrap}`);
};

/** Open (or create, when `bootstrap` is null) a room's Autobase in the
 *  identity's Corestore. Scoped: closes with the scope. */
export const openRoomLog = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  store: any,
  roomName: string,
  bootstrap: string | null,
  encryption: LogEncryption = "none",
  /** "beside": a new log made while the room's own is still open (moving the
   *  room) — straight into its own namespace: looking into the room's would
   *  wait forever on the open log's storage lock. */
  place: "room" | "beside" = "room",
): Effect.Effect<RoomLog, never, import("effect").Scope.Scope> =>
  Effect.gen(function* () {
    const base = yield* Effect.acquireRelease(
      Effect.promise(async () => {
        const namespace = place === "beside" ? store.namespace(`${roomName}/encrypted`) : await namespaceFor(store, roomName, bootstrap);
        const autobase = new Autobase(namespace, bootstrap ? b4a.from(bootstrap, "hex") : null, {
          valueEncoding: "json",
          ...(encryption === "new" ? { encrypt: true } : typeof encryption === "object" ? { encryptionKey: b4a.from(encryption.key, "hex") } : {}),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          open: (viewStore: any) =>
            new Hyperbee(viewStore.get("view"), { keyEncoding: "utf-8", valueEncoding: "json", extension: false }),
          apply,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          close: (view: any) => view.close(),
        });
        await autobase.ready();
        return autobase;
      }),
      (autobase) => Effect.promise(() => autobase.close() as Promise<void>).pipe(Effect.ignore),
    );

    const readRange = (prefix: string) =>
      Effect.promise(async () => {
        const out: Array<{ key: string; value: unknown }> = [];
        for await (const entry of base.view.createReadStream({ gte: `${prefix}/`, lt: `${prefix}0` })) out.push(entry);
        return out;
      });

    // The view is never trusted on its shape: a row written by a build that
    // spoke another protocol version can never reach the app. Reading notes
    // those rows; `evictStale` then takes them off the room for everyone.
    let stale: ReadonlyArray<string> = [];
    let rewrites: ReadonlyArray<LogOp> = [];
    let announced = -1;
    let announcedNewer = -1;
    const read: Effect.Effect<LogView> = Effect.gen(function* () {
      const bad: string[] = [];
      const migrated: LogOp[] = [];
      const rows = <A, E>(prefix: string, schema: Schema.Codec<A, E>) =>
        readRange(prefix).pipe(
          Effect.map((entries) =>
            entries.flatMap((entry) => {
              const decoded = Schema.decodeUnknownOption(schema)(entry.value);
              if (Option.isSome(decoded)) return [{ key: entry.key, value: decoded.value }];
              // an older shape we know: read it migrated, and queue the rewrite
              // that makes the row current for everyone
              const migratedRow = migrateRow(prefix, entry.value);
              if (migratedRow) {
                if (prefix === "ticket") migrated.push({ op: "ticket", ticket: migratedRow.value as Ticket });
                return [{ key: entry.key, value: migratedRow.value as A }];
              }
              if (EVICTABLE.test(entry.key)) bad.push(entry.key);
              return [];
            }),
          ),
        );
      const tickets = (yield* rows("ticket", Ticket)).map((row) => row.value);
      const members = (yield* rows("member", Member)).map((row) => row.value);
      const messages = (yield* rows("msg", RoomMessage)).map((row) => ({ seq: Number(row.key.slice("msg/".length)), message: row.value }));
      const attachments = (yield* rows("attachment", Attachment)).map((row) => row.value);
      const comments = (yield* rows("comment", ReviewComment)).map((row) => row.value);
      const reviews = (yield* rows("review", ReviewContext)).map((row) => row.value);
      const name = yield* Effect.promise(() => base.view.get("meta/name") as Promise<{ value: { name: string; ts: number } } | null>);
      // entries a build behind kept raw: list them, and queue for replay the
      // ones this build can read — once appended they apply like any entry
      // entries a build behind kept raw, in arrival order: replay every one
      // this build can decode now (apply is idempotent per record — tickets
      // merge, a review's later ts wins, a message lands once by id, a writer
      // is admitted once); list the rest once per claimed key
      const unseenRows = [...(yield* readRange("unseen"))].sort(
        // oxlint-disable-next-line naming/no-shorthand-names -- stored on disk as `n`
        (a, b) => ((a.value as { n?: number }).n ?? 0) - ((b.value as { n?: number }).n ?? 0),
      );
      const stillUnseen = new Map<string, number>();
      for (const row of unseenRows) {
        // oxlint-disable-next-line naming/no-shorthand-names -- stored on disk as `n`
        const stored = row.value as { protocol?: number; raw?: unknown; n?: number };
        const logOp = stored.protocol !== undefined && stored.protocol <= protocolForTests.ours ? Option.getOrUndefined(decodeOp(stored.raw)) : undefined;
        // the replay carries its row's key, so apply can retire exactly that row
        if (logOp) migrated.push({ ...logOp, replays: row.key });
        else stillUnseen.set(unseenClaim(row.key), Math.max(stillUnseen.get(unseenClaim(row.key)) ?? 0, stored.protocol ?? 0));
      }
      const unseen: Unseen[] = [...stillUnseen].map(([key, protocol]) => ({ key, protocol }));
      stale = bad;
      rewrites = migrated;
      if (bad.length !== announced) {
        announced = bad.length;
        if (bad.length > 0) {
          yield* Effect.logWarning(
            `${bad.length} record(s) in this room were written by an older build nobody can read any more (ours: protocol ${PROTOCOL_VERSION}) — kept out of the room and queued for eviction`,
          );
        }
      }
      if (unseen.length !== announcedNewer) {
        announcedNewer = unseen.length;
        if (unseen.length > 0) yield* Effect.logWarning(`${unseen.length} record(s) in this room were written by a newer collagen than this one — kept, unseen, until this side updates`);
      }
      const used = new Map((yield* readRange("redeemed")).map((row) => [String((row.value as { id?: unknown }).id), String((row.value as { identity?: unknown }).identity)]));
      const invites = (yield* rows("invite", InviteRecord)).map((row) => ({ ...row.value, usedBy: used.get(row.value.id) ?? null }));
      const movedRow = yield* Effect.promise(() => base.view.get("meta/moved") as Promise<{ value: { to: string; sealed: Record<string, string>; by: string } } | null>);
      const moved = movedRow ? { to: movedRow.value.to, sealed: movedRow.value.sealed, by: movedRow.value.by } : null;
      return { tickets, members, messages, attachments, comments, reviews, name: name?.value ?? null, unseen, invites, moved };
    });

    /** The migration: take the rows nobody can read off the room, for every
     *  member, by recording it on the log. Needs write access (a joiner does
     *  it once admitted); idempotent — evicting a gone row is a no-op. */
    const evictStale = Effect.gen(function* () {
      const keys = stale;
      if (keys.length === 0 || !base.writable) return 0;
      const now = yield* Clock.currentTimeMillis;
      const ok = yield* append({ op: "evict", keys, protocol: PROTOCOL_VERSION, reason: `unreadable by protocol ${PROTOCOL_VERSION}`, ts: now }).pipe(
        Effect.as(true),
        Effect.catch((row) => Effect.logWarning(`eviction failed: ${row.message}`).pipe(Effect.as(false))),
      );
      if (!ok) return 0;
      stale = [];
      yield* Effect.log(`evicted ${keys.length} unreadable record(s) from an older build: ${keys.join(", ")}`);
      return keys.length;
    });

    /** The other half of the migration: an older record we could read is
     *  written back in the current shape, so the row is current for every
     *  member and nobody else has to migrate it. Idempotent — once rewritten
     *  it decodes, and is not queued again. */
    const rewriteMigrated = Effect.gen(function* () {
      const ops = rewrites;
      if (ops.length === 0 || !base.writable) return 0;
      let rewritten = 0;
      for (const logOp of ops) {
        const ok = yield* append(logOp).pipe(
          Effect.as(true),
          Effect.catch((row) => Effect.logWarning(`migration rewrite failed: ${row.message}`).pipe(Effect.as(false))),
        );
        if (ok) rewritten++;
      }
      rewrites = [];
      if (rewritten > 0) yield* Effect.log(`brought ${rewritten} record(s) into protocol ${PROTOCOL_VERSION}: migrated from an older build, or replayed from a newer one this build can read now`);
      return rewritten;
    });

    /** Bring back what this machine wrote and the room no longer shows: walk
     *  our own writer core — every entry we ever appended — fold the ticket
     *  entries (migrated as needed) and re-append any ticket that has no row
     *  in the view. That is the case after an eviction by a build that did
     *  not yet know how to migrate the shape: the record is on the log, the
     *  row is gone, and a later build that does know puts it back. Only our
     *  own writes: they are ours to restore, and the core is right here. */
    const restoreOwn: Effect.Effect<number | null> = Effect.gen(function* () {
      // null: could not run yet (not admitted) — the caller tries again later
      if (!base.writable) return null;
      const folded = yield* Effect.promise(async () => {
        const out = new Map<string, Ticket>();
        // our own whys too: the newest we wrote for each ticket
        const whys = new Map<string, ReviewContext>();
        const core = base.local;
        for (let index = 0; index < core.length; index++) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const block: any = await core.get(index).catch(() => null);
          const buffer: Uint8Array | null | undefined = block?.node?.value;
          if (!buffer) continue;
          let raw: unknown;
          try {
            raw = JSON.parse(b4a.toString(buffer, "utf8"));
          } catch {
            continue;
          }
          const logOp = migrateOp(raw) ?? Option.getOrUndefined(decodeOp(raw));
          if (logOp?.op === "review") {
            const had = whys.get(logOp.review.ticketId);
            if (!had || supersedes(logOp.review, had)) whys.set(logOp.review.ticketId, logOp.review);
          }
          if (!logOp || logOp.op !== "ticket") continue;
          const have = out.get(logOp.ticket.id);
          out.set(logOp.ticket.id, have ? mergeTicket(have, logOp.ticket) : logOp.ticket);
        }
        // a row that exists may still lack what WE wrote — another peer
        // restored first from their own history, without our take or our
        // settle — so the test is not "is there a row" but "would our copy
        // change it"; re-appending is a merge, never a replacement
        const missing: Ticket[] = [];
        for (const [id, ticket] of out) {
          const row = await base.view.get(`ticket/${id}`);
          const current = row ? readTicket(row.value)?.value : undefined;
          if (!current || contributes(current, ticket)) missing.push(ticket);
        }
        // a why is whole, later ts wins: ours goes back when the room has none
        // (evicted by a build that could not read it) or an older one
        const lostWhys: ReviewContext[] = [];
        for (const [id, why] of whys) {
          const row = await base.view.get(`review/${id}`);
          if (!row || strictlySupersedes(why, row.value as ReviewContext)) lostWhys.push(why);
        }
        return { missing, lostWhys };
      });
      let restored = 0;
      for (const why of folded.lostWhys) {
        const ok = yield* append({ op: "review", review: why, protocol: PROTOCOL_VERSION }).pipe(
          Effect.as(true),
          Effect.catch((error) => Effect.logWarning(`restore failed for the why of ticket ${why.ticketId}: ${error.message}`).pipe(Effect.as(false))),
        );
        if (ok) restored++;
      }
      if (folded.lostWhys.length > 0) yield* Effect.log(`restored this machine's own why on ${folded.lostWhys.length} ticket(s): ${folded.lostWhys.map((why) => why.ticketId.slice(0, 8)).join(", ")}`);
      for (const ticket of folded.missing) {
        const ok = yield* append({ op: "ticket", ticket }).pipe(
          Effect.as(true),
          Effect.catch((error) => Effect.logWarning(`restore failed for ticket ${ticket.id}: ${error.message}`).pipe(Effect.as(false))),
        );
        if (ok) restored++;
      }
      if (folded.missing.length > 0) yield* Effect.log(`restored this machine's own contribution to ${folded.missing.length} ticket(s): ${folded.missing.map((ticket) => ticket.id.slice(0, 8)).join(", ")}`);
      return restored;
    });

    const changes = Stream.callback<void>((queue) =>
      Effect.gen(function* () {
        const fire = () => void Queue.offerUnsafe(queue, undefined);
        base.on("update", fire);
        base.on("writable", fire);
        base.on("unwritable", fire);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            base.off("update", fire);
            base.off("writable", fire);
            base.off("unwritable", fire);
          }),
        );
      }),
    );

    /** Append, then bring our own view up so the caller can read what it just
     *  wrote. `base.update()` is the second half, and on a peer that is still
     *  catching up it can wait on another member and never resolve — which
     *  used to park whatever fibre called it, boot included (a returning peer
     *  logged "room log opened" and then nothing). The entry is already on our
     *  core by then, so after a few seconds we carry on and let the `changes`
     *  stream bring the view up when it can. */
    // every entry says which build wrote it, so an older reader can tell
    // "newer than me" from "broken" (see LogOp). No caller in the app sets
    // it; a test does, to play a peer from the future.
    const append = (logOp: LogOp) => appendAll([logOp]);
    /** Several entries as one batch — a room moved to a new log arrives whole. */
    const appendAll = (logOps: ReadonlyArray<LogOp>) =>
      Effect.tryPromise({
        try: () => base.append(logOps.map((logOp) => ({ ...logOp, protocol: logOp.protocol ?? PROTOCOL_VERSION }))) as Promise<void>,
        catch: (cause) => new LogAppendFailed({ cause }),
      }).pipe(
        Effect.andThen(
          Effect.tryPromise({
            try: () => base.update() as Promise<void>,
            catch: (cause) => new LogAppendFailed({ cause }),
          }).pipe(
            Effect.timeoutOption(UPDATE_PATIENCE),
            Effect.flatMap((done) =>
              Option.isNone(done)
                ? Effect.logWarning(`the room's log is still catching up (${logOps.map((logOp) => logOp.op).join(", ")} written, the view will follow)`)
                : Effect.void,
            ),
          ),
        ),
      );

    return {
      key: b4a.toString(base.key, "hex"),
      writerKey: b4a.toString(base.local.key, "hex"),
      encryptionKey: base.encryptionKey ? b4a.toString(base.encryptionKey, "hex") : null,
      writable: () => base.writable as boolean,
      append,
      appendAll,
      read,
      evictStale,
      rewriteMigrated,
      restoreOwn,
      changes,
    };
  });
