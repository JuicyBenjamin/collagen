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

/** The wire protocol this build speaks. Bump on any change to frames, log
 *  entries or the view layout; peers show a mismatch instead of silently
 *  dropping each other's frames. */
export const PROTOCOL_VERSION = "1";

export const SharedProfile = Schema.Struct({
  name: Schema.String,
  /** PROTOCOL_VERSION of the sender; absent = a build from before it existed. */
  protocol: Schema.optional(Schema.String),
  ai: Schema.NullOr(Schema.String),
  /** Whether the peer's preferred agent CLI is actually usable — visible to
   *  the whole room so "claude-code (unauthenticated)" is no surprise. */
  aiStatus: Schema.optional(AiStatus),
  projects: Schema.Array(SharedProject),
  /** Connected to this room but working in another one: present for
   *  messages, not counted as online, nothing auto-runs for them. */
  away: Schema.optional(Schema.Boolean),
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
  /** Recipient pubkey (hex) — messages live on the room's shared log, so the
   *  record itself says who it is for. */
  to: Schema.String,
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
/** "This room's log is this Autobase" — sent in the greet by anyone who knows. */
export const LogInfoFrame = Schema.Struct({
  kind: Schema.Literal("log-info"),
  key: Schema.String,
  /** How many members that log has — lets two sides that each started a log
   *  agree on which one to keep (a log nobody else is on yields). */
  members: Schema.optional(Schema.Finite),
});
/** "Admit my writer core to the room's log" — a joiner asks a member. */
export const JoinLogFrame = Schema.Struct({
  kind: Schema.Literal("join-log"),
  writer: Schema.String,
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

/** Ephemeral frames — what is said connection-to-connection and not
 *  remembered: presence, log bootstrap, remote control. Everything that must
 *  outlive a connection (messages, tickets, the room name, membership) is a
 *  LogOp on the room's shared log instead. */
export const Frame = Schema.Union([ProfileFrame, LogInfoFrame, JoinLogFrame, DriveFrame]);
export type Frame = typeof Frame.Type;

/** One entry on a room's Autobase log. Applied deterministically by every
 *  member into the room's view (see RoomLog). */
export const LogOp = Schema.Union([
  /** Admit a writer core to the log (any member may append this). */
  Schema.Struct({ op: Schema.Literal("add-writer"), key: Schema.String }),
  /** A member introducing itself (so names resolve even while offline). */
  Schema.Struct({ op: Schema.Literal("member"), key: Schema.String, name: Schema.String, ts: Schema.Finite }),
  /** The full ticket record; the view merges it with what it holds. */
  Schema.Struct({ op: Schema.Literal("ticket"), ticket: Ticket }),
  /** The room's shared name — last writer wins by ts. */
  Schema.Struct({ op: Schema.Literal("rename"), name: Schema.String, ts: Schema.Finite }),
  /** A directed message; room-visible, delivered to `msg.to` whenever they read the log. */
  Schema.Struct({ op: Schema.Literal("msg"), msg: RoomMessage }),
]);
export type LogOp = typeof LogOp.Type;

/** A member as recorded on the log. */
export interface Member {
  readonly key: string;
  readonly name: string;
  readonly ts: number;
}

/** What actually crosses a connection: a frame addressed to one room. One
 *  connection per peer carries every room the two of you share, so each
 *  frame names its room by topic (the hex of the swarm topic — knowing it
 *  reveals nothing about other rooms, and only rooms the peer was discovered
 *  in are ever mentioned to them). */
export const Envelope = Schema.Struct({
  topic: Schema.String,
  frame: Frame,
});
export type Envelope = typeof Envelope.Type;

/** Wire codec: JSON string <-> validated Envelope. */
export const EnvelopeFromJson = Schema.fromJsonString(Envelope);

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
  /** roomId → threadId → log position of the last message pulled from the
   *  inbox. Messages live on the room's log; this is what makes "waiting"
   *  a local, per-reader notion that survives restarts. */
  consumed: Schema.optional(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Finite))),
});
export type LocalState = typeof LocalState.Type;
