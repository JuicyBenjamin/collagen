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
export const SharedProfile = Schema.Struct({
  name: Schema.String,
  ai: Schema.NullOr(Schema.String),
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
export const Frame = Schema.Union([ProfileFrame, MessageFrame, TicketFrame]);
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

/** Local, per-user state (preferred AI + project pool + per-room enables). */
export const LocalState = Schema.Struct({
  preferredAi: Schema.NullOr(Schema.String),
  pool: Schema.Array(Project),
  rooms: Schema.Record(Schema.String, Schema.Array(Schema.String)),
});
export type LocalState = typeof LocalState.Type;
