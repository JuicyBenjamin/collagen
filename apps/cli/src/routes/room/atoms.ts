import { Effect, Stream, SubscriptionRef } from "effect";
import { type LocalState } from "@collagen/p2p";
import { AiStatus } from "../../services/AiStatus";
import { Attachments } from "../../services/Attachments";
import { IdentityService } from "../../services/Identity";
import { Outbox } from "../../services/Outbox";
import { Rooms } from "../../services/Rooms";
import { StateStore } from "../../services/StateStore";
import { Updates } from "../../services/Updates";
import { runtimeAtom } from "../../app/runtime";

// Read by the room layout and/or more than one of its sections. Everything
// room-scoped follows the FOCUSED room — switch rooms and these re-subscribe.

export const identityAtom = runtimeAtom.atom(
  Effect.gen(function* () {
    return (yield* IdentityService).identity;
  }),
);

/** Local per-user state: preferred ai, per-room projects, adopted threads. */
export const stateAtom = runtimeAtom.atom(
  Stream.unwrap(Effect.gen(function* () {
    return SubscriptionRef.changes((yield* StateStore).state);
  })),
);

/** All state mutations funnel through here: pass a reducer, StateStore
 *  persists and the daemons re-broadcast the profile.
 *  The reducer is WRAPPED in an object: atom-react treats a bare function
 *  argument to a setter as an updater of the atom's own value (which is an
 *  AsyncResult, not our state) — that ambiguity silently ate every update. */
export const updateStateAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* ({ update }: { update: (s: LocalState) => LocalState }) {
    const store = yield* StateStore;
    yield* store.update(update);
  }),
);

/** Whether the preferred agent CLI is installed and authenticated. */
export const aiStatusAtom = runtimeAtom.atom(
  Stream.unwrap(Effect.gen(function* () {
    return SubscriptionRef.changes((yield* AiStatus).current);
  })),
);

/** Peers present in the focused room (emits the current value on subscribe). */
export const rosterAtom = runtimeAtom.atom(
  Stream.unwrap(Effect.gen(function* () {
    return (yield* Rooms).watch((h) => SubscriptionRef.changes(h.room.roster));
  })),
);

/** Everyone the focused room's log remembers — names for offline peers. */
export const membersAtom = runtimeAtom.atom(
  Stream.unwrap(Effect.gen(function* () {
    return (yield* Rooms).watch((h) => SubscriptionRef.changes(h.room.members));
  })),
);

/** Every message in the focused room, in log order — the a2a trace. */
export const traceAtom = runtimeAtom.atom(
  Stream.unwrap(Effect.gen(function* () {
    return (yield* Rooms).watch((h) => SubscriptionRef.changes(h.room.trace));
  })),
);

/** Whether we can write to the focused room's log yet (a member admits us). */
export const admittedAtom = runtimeAtom.atom(
  Stream.unwrap(Effect.gen(function* () {
    return (yield* Rooms).watch((h) => SubscriptionRef.changes(h.room.writable));
  })),
);

/** Everything the agent wants to send, across rooms, waiting for the person. */
export const outboxAtom = runtimeAtom.atom(
  Stream.unwrap(Effect.gen(function* () {
    return (yield* Outbox).changes;
  })),
);

/** The person rewrote the text before sending. */
export const editOutgoingAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* ({ id, text }: { id: string; text: string }) {
    yield* (yield* Outbox).edit(id, text);
  }),
);

/** The person approves: it leaves now. */
export const approveOutgoingAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* ({ id }: { id: string }) {
    return yield* (yield* Outbox).approve(id);
  }),
);

/** The person rejects: it never leaves. */
export const rejectOutgoingAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* ({ id }: { id: string }) {
    yield* (yield* Outbox).reject(id);
  }),
);

/** Files attached to the focused room's tickets — references on the log. */
export const attachmentsAtom = runtimeAtom.atom(
  Stream.unwrap(Effect.gen(function* () {
    return (yield* Rooms).watch((h) => SubscriptionRef.changes(h.room.attachments));
  })),
);
/** Attachments whose file is on this machine — fetched, or attached by us:
 *  id → path. Live: a file landing re-reads the folders. */
export const heldAttachmentsAtom = runtimeAtom.atom(
  Stream.unwrap(Effect.gen(function* () {
    const a = yield* Attachments;
    const store = yield* StateStore;
    return Stream.merge(
      SubscriptionRef.changes(a.saved).pipe(Stream.map(() => undefined)),
      SubscriptionRef.changes(store.state).pipe(Stream.map(() => undefined)),
    ).pipe(Stream.mapEffect(() => a.held));
  })),
);
/** Ask the holder for an attachment's file (both online). */
export const fetchAttachmentAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* ({ roomId, attachmentId }: { roomId: string; attachmentId: string }) {
    return yield* (yield* Attachments).fetch(roomId, attachmentId);
  }),
);
/** Attach files you hold to a ticket — a proposal in your outbox. */
export const attachFilesAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* ({ roomId, ticketId, goal, paths }: { roomId: string; ticketId: string; goal: string; paths: ReadonlyArray<string> }) {
    return yield* (yield* Attachments).attach(roomId, ticketId, goal, paths);
  }),
);

/** Is a newer collagen on npm; is an install running; what to tell the user. */
export const appUpdateAtom = runtimeAtom.atom(
  Stream.unwrap(Effect.gen(function* () {
    return SubscriptionRef.changes((yield* Updates).state);
  })),
);

/** Install the newer version. Resolves true when the app should restart. */
export const installAppUpdateAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* (_: object) {
    return yield* (yield* Updates).install;
  }),
);
