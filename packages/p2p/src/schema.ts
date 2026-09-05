import { Schema } from "effect";
import { Ticket } from "./ticket";

// Wire + persisted shapes. Everything that crosses a process boundary
// (swarm frames, state files) is Schema-validated at the edge.

export const SharedProject = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
});
export type SharedProject = typeof SharedProject.Type;

/** What each peer broadcasts about itself in a room. */
export const AiStatus = Schema.Literals(["ok", "unauthenticated", "missing", "unknown"]);
export type AiStatus = typeof AiStatus.Type;

export const SharedProfile = Schema.Struct({
  name: Schema.String,
  ai: Schema.NullOr(Schema.String),
  /** Whether the peer's preferred agent CLI is actually usable — visible to
   *  the whole room so "claude-code (unauthenticated)" is no surprise. */
  aiStatus: Schema.optional(AiStatus),
  projects: Schema.Array(SharedProject),
});
export type SharedProfile = typeof SharedProfile.Type;

export const Peer = Schema.Struct({
  ...SharedProfile.fields,
  key: Schema.String,
});
export type Peer = typeof Peer.Type;

/** A directed message from one peer to another within a room. */
export const RoomMessage = Schema.Struct({
  id: Schema.String,
  /** Conversation key — deterministic per peer-pair|project (symmetric), so
   *  replies continue in the same AI session on both sides. */
  threadId: Schema.String,
  from: Schema.String, // sender pubkey (hex)
  fromName: Schema.String,
  project: Schema.String,
  intent: Schema.String,
  findings: Schema.String,
  ts: Schema.Finite,
});
export type RoomMessage = typeof RoomMessage.Type;

export const ProfileFrame = Schema.Struct({
  kind: Schema.Literal("profile"),
  profile: SharedProfile,
});
export const MessageFrame = Schema.Struct({
  kind: Schema.Literal("msg"),
  msg: RoomMessage,
});
export const TicketFrame = Schema.Struct({
  kind: Schema.Literal("ticket"),
  ticket: Ticket,
});
/** The room's shared display name — broadcast, last-writer-wins by ts. */
export const RoomMetaFrame = Schema.Struct({
  kind: Schema.Literal("room-meta"),
  name: Schema.String,
  ts: Schema.Finite,
});

/** Remote-control for end-to-end testing: asks a peer to perform an action
 *  as itself. Only peers running a mock AI obey (the receiver enforces it) —
 *  a real user can't be puppeted. */
export const DriveAction = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("send-message"),
    project: Schema.String,
    intent: Schema.String,
    findings: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("create-ticket"),
    project: Schema.String,
    goal: Schema.String,
    steps: Schema.Array(
      Schema.Struct({
        intent: Schema.String,
        description: Schema.String,
        /** true: the driven (mock) peer owns the step; false: the requester. */
        mine: Schema.Boolean,
      }),
    ),
  }),
  Schema.Struct({
    kind: Schema.Literal("settle-step"),
    ticketId: Schema.String,
    stepId: Schema.String,
    result: Schema.String,
  }),
]);
export type DriveAction = typeof DriveAction.Type;

export const DriveFrame = Schema.Struct({
  kind: Schema.Literal("drive"),
  action: DriveAction,
});

export const Frame = Schema.Union([ProfileFrame, MessageFrame, TicketFrame, RoomMetaFrame, DriveFrame]);
export type Frame = typeof Frame.Type;

/** Wire codec: JSON string <-> validated Frame. */
export const FrameFromJson = Schema.fromJsonString(Frame);

export const Bootstrap = Schema.Array(
  Schema.Struct({ host: Schema.String, port: Schema.Finite }),
);
export type Bootstrap = typeof Bootstrap.Type;

/** A user-owned project (a local repo/codebase the user's agent works on). */
export const Project = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  path: Schema.String,
});
export type Project = typeof Project.Type;

/** A conversation the user's own agent session has claimed: new messages on
 *  the thread resume that session (via the agent CLI's resume mechanism)
 *  instead of queueing. */
export const AdoptedThread = Schema.Struct({
  ai: Schema.String,
  sessionId: Schema.String,
});
export type AdoptedThread = typeof AdoptedThread.Type;

/** Local, per-user state: preferred AI + per-room projects. A project
 *  belongs to the room it was added in (Keet-style) — the same repo shared
 *  into two rooms is two entries. */
export const LocalState = Schema.Struct({
  preferredAi: Schema.NullOr(Schema.String),
  rooms: Schema.Record(Schema.String, Schema.Array(Project)),
  /** threadId → the user's adopted conversation for it. */
  threads: Schema.optional(Schema.Record(Schema.String, AdoptedThread)),
});
export type LocalState = typeof LocalState.Type;
