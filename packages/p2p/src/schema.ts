import { Schema } from "effect";
import { ReviewContext } from "./review";
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
 *  dropping each other's frames.
 *
 *  One version at a time: this is an alpha, and nothing here carries a path
 *  for an older build's shapes. A peer on another version is told to update,
 *  not accommodated. */
export const PROTOCOL_VERSION = "2";

export const SharedProfile = Schema.Struct({
  name: Schema.String,
  /** PROTOCOL_VERSION of the sender. */
  protocol: Schema.String,
  ai: Schema.NullOr(Schema.String),
  /** Whether the peer's preferred agent CLI is actually usable — visible to
   *  the whole room so "claude-code (unauthenticated)" is no surprise. */
  aiStatus: AiStatus,
  projects: Schema.Array(SharedProject),
  /** Connected to this room but working in another one: present for
   *  messages, not counted as online, nothing auto-runs for them. */
  away: Schema.Boolean,
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
  /** Set when the message weighs in on a ticket — anyone in the room may,
   *  asked or not; the ticket's page gathers these. */
  ticketId: Schema.optional(Schema.String),
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
  members: Schema.Finite,
});
/** "Admit my writer core to the room's log" — a joiner asks a member. */
export const JoinLogFrame = Schema.Struct({
  kind: Schema.Literal("join-log"),
  writer: Schema.String,
});

/** The actions a driven peer can be asked to perform. One list, so a tool
 *  that offers them cannot fall behind the union below: `drive-peer` takes
 *  this as its `action` and dispatches over it exhaustively. */
export const DriveActionKind = Schema.Literals(["send-message", "create-ticket", "settle-step", "post-review"]);
export type DriveActionKind = typeof DriveActionKind.Type;

/** Remote-control for end-to-end testing: asks a peer to perform an action
 *  as itself. Only peers running a mock AI obey (the receiver enforces it) —
 *  a real user can't be puppeted. Every member's `kind` comes from
 *  `DriveActionKind`. */
export const DriveAction = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("send-message"),
    project: Schema.String,
    intent: Schema.String,
    findings: Schema.String,
    ticketId: Schema.optional(Schema.String),
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
  Schema.Struct({
    kind: Schema.Literal("post-review"),
    ticketId: Schema.String,
    result: Schema.String,
  }),
]);
export type DriveAction = typeof DriveAction.Type;

export const DriveFrame = Schema.Struct({
  kind: Schema.Literal("drive"),
  action: DriveAction,
});

/** "Send me your agent's conversation on these threads" — a diagnostic ask
 *  from a peer. Kept on the receiving machine until its person says to hand
 *  it over: the one thing here nobody on that side asked for. Direct and
 *  ephemeral: never on the shared log. */
export const TranscriptRequestFrame = Schema.Struct({
  kind: Schema.Literal("transcript-request"),
  requestId: Schema.String,
  /** What the threads belong to, for the folder it is saved under. */
  subject: Schema.String,
  threadIds: Schema.Array(Schema.String),
});

/** One agent conversation slice, handed over because its person said so.
 *  `data` is the session file's lines from `since` on, gzip + base64. */
export const TranscriptFrame = Schema.Struct({
  kind: Schema.Literal("transcript"),
  requestId: Schema.String,
  subject: Schema.String,
  threadId: Schema.String,
  ai: Schema.String,
  sessionId: Schema.String,
  since: Schema.Finite,
  entries: Schema.Finite,
  data: Schema.String,
});

/** What makes an attached file a transcript: whose conversation, which
 *  agent, which thread / session, how much — its meta file, in short. */
export const TranscriptInfo = Schema.Struct({
  from: Schema.String,
  ai: Schema.String,
  threadId: Schema.String,
  sessionId: Schema.String,
  entries: Schema.Finite,
  since: Schema.Finite,
  /** The subject it was first collected under. */
  origin: Schema.String,
});
export type TranscriptInfo = typeof TranscriptInfo.Type;

/** A file someone holds, as they pick it to attach: the path is the holder's
 *  own and never leaves the machine (the log gets an Attachment). */
export const AttachItem = Schema.Struct({
  file: Schema.String,
  name: Schema.String,
  bytes: Schema.Finite,
  mime: Schema.String,
  transcript: Schema.optional(TranscriptInfo),
});
export type AttachItem = typeof AttachItem.Type;

/** A file attached to a ticket — a screenshot, a document, a transcript — as
 *  the reference on the room's log, so everyone sees it is there whether or
 *  not the holder is online. The file itself stays with the holder until a
 *  member fetches it (both online). */
export const Attachment = Schema.Struct({
  id: Schema.String,
  ticketId: Schema.String,
  /** Who holds the file (key) and their name at the time. */
  holder: Schema.String,
  holderName: Schema.String,
  name: Schema.String,
  bytes: Schema.Finite,
  mime: Schema.String,
  /** Why it is here, in the holder's words. */
  note: Schema.optional(Schema.String),
  /** Present when the file is an agent's conversation. */
  transcript: Schema.optional(TranscriptInfo),
  attachedAt: Schema.Finite,
});
export type Attachment = typeof Attachment.Type;

/** "Send me attachment X" — to its holder, when both are online. */
export const FetchAttachmentFrame = Schema.Struct({
  kind: Schema.Literal("fetch-attachment"),
  attachmentId: Schema.String,
});
export type FetchAttachmentFrame = typeof FetchAttachmentFrame.Type;

/** The file, to the one who asked: its bytes gzipped, base64. */
export const AttachmentFrame = Schema.Struct({
  kind: Schema.Literal("attachment"),
  attachmentId: Schema.String,
  data: Schema.String,
});
export type AttachmentFrame = typeof AttachmentFrame.Type;

/** Ephemeral frames — what is said connection-to-connection and not
 *  remembered: presence, log bootstrap, remote control, transcripts.
 *  Everything that must outlive a connection (messages, tickets, the room
 *  name, membership) is a LogOp on the room's shared log instead. */
export const Frame = Schema.Union([ProfileFrame, LogInfoFrame, JoinLogFrame, DriveFrame, TranscriptRequestFrame, TranscriptFrame, FetchAttachmentFrame, AttachmentFrame]);
export type TranscriptRequestFrame = typeof TranscriptRequestFrame.Type;
export type TranscriptFrame = typeof TranscriptFrame.Type;
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
  /** A file attached to a ticket (the reference; the holder keeps the file). */
  Schema.Struct({ op: Schema.Literal("attachment"), attachment: Attachment }),
  /** The why behind a review ticket's change — its author is its only writer,
   *  so the later ts wins (an amendment carries the whole record). */
  Schema.Struct({ op: Schema.Literal("review"), review: ReviewContext }),
  /** The migration. The log is append-only, so a record written by a build
   *  that spoke another protocol version cannot be rewritten — this is how it
   *  stops being part of the room instead: the rows it left in the view are
   *  dropped. Recorded on the log, so every member applies the same cleanup
   *  and the room converges clean rather than each side hiding its own mess. */
  Schema.Struct({
    op: Schema.Literal("evict"),
    keys: Schema.Array(Schema.String),
    /** Who did the evicting and why — the log keeps its own history. */
    protocol: Schema.String,
    reason: Schema.String,
    ts: Schema.Finite,
  }),
]);
export type LogOp = typeof LogOp.Type;

/** What an `evict` may remove: room records only, never the room's meta. */
export const EVICTABLE = /^(ticket|review|attachment|msg|member)\//;

/** A member as recorded on the log. */
export const Member = Schema.Struct({
  key: Schema.String,
  name: Schema.String,
  ts: Schema.Finite,
});
export type Member = typeof Member.Type;

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
  /** When it was adopted — a transcript handed over on request starts here,
   *  never earlier: the session may hold unrelated work before that. */
  since: Schema.optional(Schema.Finite),
});
export type AdoptedThread = typeof AdoptedThread.Type;

/** Something that goes out of this machine, as data — so what went can be
 *  shown, and kept across a restart. A message names its peer (resolved as it
 *  is sent); a ticket is the full record; a settle names the step and the
 *  result. */
export const Outgoing = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("message"),
    peer: Schema.String,
    project: Schema.String,
    intent: Schema.String,
    findings: Schema.String,
    ticketId: Schema.optional(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal("ticket"), ticket: Ticket }),
  /** A review ticket: the record and the why behind the change, together —
   *  one thing, since the review context quotes how THEY steered the work. `ticket` is absent on an amendment to
   *  a review that is already on the log. */
  Schema.Struct({
    kind: Schema.Literal("review"),
    ticket: Schema.optional(Ticket),
    review: ReviewContext,
  }),
  /** A review your user read and wants on the ticket — theirs, whether or not
   *  they were the one asked (see p2p postReview). */
  Schema.Struct({
    kind: Schema.Literal("post-review"),
    ticketId: Schema.String,
    findings: Schema.String,
    failed: Schema.Boolean,
  }),
  Schema.Struct({
    kind: Schema.Literal("settle"),
    ticketId: Schema.String,
    stepId: Schema.String,
    result: Schema.String,
    failed: Schema.Boolean,
  }),
  /** Attach files you hold to a ticket: references go on the log; the files
   *  go to members who fetch them while you are online. */
  Schema.Struct({
    kind: Schema.Literal("attach"),
    ticketId: Schema.String,
    goal: Schema.String,
    items: Schema.Array(AttachItem),
    note: Schema.optional(Schema.String),
  }),
  /** Hand a peer the agent's conversation on one thread, from adoption on. */
  Schema.Struct({
    kind: Schema.Literal("transcript"),
    requestId: Schema.String,
    subject: Schema.String,
    /** The requester's key — the file goes to them alone. */
    requester: Schema.String,
    threadId: Schema.String,
    ai: Schema.String,
    sessionId: Schema.String,
    since: Schema.Finite,
  }),
]);
export type Outgoing = typeof Outgoing.Type;

/** A peer has asked for your agent's conversation on one thread. Kept as
 *  data, not answered: a transcript is your session, so it leaves only when
 *  you tell your agent to hand it over (see cli Transcripts). */
export const TranscriptAsk = Schema.Struct({
  roomId: Schema.String,
  requestId: Schema.String,
  subject: Schema.String,
  /** The asker's key — the file goes to them alone. */
  requester: Schema.String,
  /** Their name when they asked, for the line the person reads. */
  requesterName: Schema.String,
  threadId: Schema.String,
  ai: Schema.String,
  sessionId: Schema.String,
  since: Schema.Finite,
  ts: Schema.Finite,
});
export type TranscriptAsk = typeof TranscriptAsk.Type;

/** One thing that went out (or is going out this instant): where it went and
 *  how it is shown. */
export const Proposal = Schema.Struct({
  id: Schema.String,
  roomId: Schema.String,
  /** Who it goes to, by name (a peer, the step owners, or the ticket's creator). */
  to: Schema.String,
  /** One line: project · intent, or the ticket goal. */
  title: Schema.String,
  ts: Schema.Finite,
  outgoing: Outgoing,
});
export type Proposal = typeof Proposal.Type;

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
  /** What has gone out of here, newest first (see cli Outbox) — a record, not
   *  a queue: nothing waits for approval. */
  sent: Schema.optional(Schema.Array(Proposal)),
  /** Transcript requests waiting on the person's word — asked for by a peer,
   *  never answered by itself. */
  transcriptAsks: Schema.optional(Schema.Array(TranscriptAsk)),
  /** Files we attached to tickets: attachment id → our local path, so a fetch
   *  can be answered (only for ids here — nothing else ever leaves). */
  attachedFiles: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});
export type LocalState = typeof LocalState.Type;
