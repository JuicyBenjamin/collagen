import { Schema } from "effect";
import { Conversation } from "./acting";
import { DraftComment, ReviewComment, ReviewContext } from "./review";
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
export const PROTOCOL_VERSION = "13";

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
  /** Which of the sender's agents wrote it (Claude Code, Codex …); absent
   *  when the person did, or nobody knows. Attribution: the words are still
   *  the sender's. */
  agent: Schema.optional(Schema.String),
  /** Which of that agent's conversations wrote it, when the harness said. */
  conversation: Schema.optional(Conversation),
});
export type RoomMessage = typeof RoomMessage.Type;

export const ProfileFrame = Schema.Struct({
  kind: Schema.Literal("profile"),
  profile: SharedProfile,
  /** a peer's first greeting in this room since it (re)joined: whoever
   *  already knew it starts over with it — greets back and says where the
   *  log is — since it holds nothing from before. Absent on a greeting
   *  answered, and from builds before it (read as today). */
  hello: Schema.optional(Schema.Literal(true)),
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
    /** true: the review asks for changes, as post-review's own `failed` does. */
    failed: Schema.optional(Schema.Boolean),
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
/** Every entry carries the PROTOCOL_VERSION of the build that wrote it
 *  (`append` stamps it; entries from before protocol 5 have none). A reader
 *  on an OLDER build leaves a newer entry alone — not applied, not evicted —
 *  so a room with mixed builds loses nothing; the older side is told to
 *  update. Without this, "unreadable" meant "evict", and a new ticket kind
 *  would have been wiped by the first peer who had not updated yet.
 *  `replays` names the raw `unseen/…` row an entry was replayed from, so
 *  apply removes exactly that row, and only once the entry applied. */
export const LogOp = Schema.Union([
  /** Admit a writer core to the log (any member may append this). */
  Schema.Struct({ protocol: Schema.optional(Schema.String), replays: Schema.optional(Schema.String), op: Schema.Literal("add-writer"), key: Schema.String }),
  /** A member introducing itself (so names resolve even while offline). */
  Schema.Struct({ protocol: Schema.optional(Schema.String), replays: Schema.optional(Schema.String), op: Schema.Literal("member"), key: Schema.String, name: Schema.String, ts: Schema.Finite }),
  /** The full ticket record; the view merges it with what it holds. */
  Schema.Struct({ protocol: Schema.optional(Schema.String), replays: Schema.optional(Schema.String), op: Schema.Literal("ticket"), ticket: Ticket }),
  /** The room's shared name — last writer wins by ts. */
  Schema.Struct({ protocol: Schema.optional(Schema.String), replays: Schema.optional(Schema.String), op: Schema.Literal("rename"), name: Schema.String, ts: Schema.Finite }),
  /** A directed message; room-visible, delivered to `msg.to` whenever they read the log. */
  Schema.Struct({ protocol: Schema.optional(Schema.String), replays: Schema.optional(Schema.String), op: Schema.Literal("msg"), msg: RoomMessage }),
  /** A file attached to a ticket (the reference; the holder keeps the file). */
  Schema.Struct({ protocol: Schema.optional(Schema.String), replays: Schema.optional(Schema.String), op: Schema.Literal("attachment"), attachment: Attachment }),
  /** The why behind a review ticket's change — its author is its only writer,
   *  so the later ts wins (an amendment carries the whole record). */
  Schema.Struct({ protocol: Schema.optional(Schema.String), replays: Schema.optional(Schema.String), op: Schema.Literal("review"), review: ReviewContext }),
  /** A comment on a review's code — written once by its author, never
   *  changed: the first write of an id stands. */
  Schema.Struct({ protocol: Schema.optional(Schema.String), replays: Schema.optional(Schema.String), op: Schema.Literal("comment"), comment: ReviewComment }),
  /** The migration. The log is append-only, so a record written by a build
   *  that spoke another protocol version cannot be rewritten — this is how it
   *  stops being part of the room instead: the rows it left in the view are
   *  dropped. Recorded on the log, so every member applies the same cleanup
   *  and the room converges clean rather than each side hiding its own mess. */
  Schema.Struct({
    replays: Schema.optional(Schema.String),
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
export const EVICTABLE = /^(ticket|review|attachment|comment|msg|member)\//;

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
    /** words with no verdict: neither approves nor asks for changes */
    comment: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({
    kind: Schema.Literal("settle"),
    ticketId: Schema.String,
    stepId: Schema.String,
    result: Schema.String,
    failed: Schema.Boolean,
  }),
  /** A step nobody has, taken by the person: theirs from then on (p2p takeStep). */
  Schema.Struct({
    kind: Schema.Literal("take"),
    ticketId: Schema.String,
    stepId: Schema.String,
  }),
  /** The author closes their ticket: off the lists, on the log, steps as they were. */
  Schema.Struct({
    kind: Schema.Literal("close"),
    ticketId: Schema.String,
    reason: Schema.optional(Schema.String),
    /** how it ended — counted done in its epic, or out of its progress */
    outcome: Schema.optional(Schema.Literals(["done", "dropped"])),
  }),
  /** Tickets put into an epic, moved to another, or taken out (`epic`
   *  null) — anyone's to do; `goal` is the epic's, for the record. */
  Schema.Struct({
    kind: Schema.Literal("epic-move"),
    ticketIds: Schema.Array(Schema.String),
    epic: Schema.NullOr(Schema.String),
    goal: Schema.String,
    /** the epic's title when this was sent, the name the outbox shows it by */
    name: Schema.optional(Schema.String),
    /** kept in the epic but out of its progress (or, false, counted again) */
    excluded: Schema.optional(Schema.Boolean),
  }),
  /** The order an epic's tickets are read in — anyone's to set; gates nothing. */
  Schema.Struct({
    kind: Schema.Literal("epic-order"),
    epicId: Schema.String,
    goal: Schema.String,
    /** the epic's title when this was sent, the name the outbox shows it by */
    name: Schema.optional(Schema.String),
    ticketIds: Schema.Array(Schema.String),
  }),
  /** An epic closed or reopened — anyone's to do, with its reason. */
  Schema.Struct({
    kind: Schema.Literal("epic-turn"),
    epicId: Schema.String,
    closed: Schema.Boolean,
    reason: Schema.optional(Schema.String),
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
  /** Which agent sent it (Claude Code, Codex …); absent when the person did. */
  agent: Schema.optional(Schema.String),
  /** Which of its conversations, when the harness said. */
  conversation: Schema.optional(Conversation),
});
export type Proposal = typeof Proposal.Type;

/** What one of the person's AI conversations has worked on here: the
 *  threads it wrote on and the tickets it acted on, newest last — and how
 *  to reach it, and the tickets it said it wants to hear about. Local,
 *  never broadcast (cli lib/worked, lib/reach). What it worked on is
 *  delivered to it only when the person's delivery steering lets it. */
export const Worked = Schema.Struct({
  conversation: Conversation,
  threads: Schema.Array(Schema.String),
  tickets: Schema.Array(Schema.String),
  /** when it last acted */
  last: Schema.Finite,
  /** Claude Code: the session's messaging socket, as last seen on one of its calls */
  socket: Schema.optional(Schema.String),
  /** tickets its person said yes to hearing about here (watch-ticket) */
  watching: Schema.optional(Schema.Array(Schema.String)),
});
export type Worked = typeof Worked.Type;

/** The jobs collagen runs an AI for, each with a model the person may choose. */
export const JobKind = Schema.Literals(["wake", "research", "investigation"]);
export type JobKind = typeof JobKind.Type;

/** A model run collagen made itself, in the person's name (cli AgentRunner,
 *  Jobs): a courier waking a conversation, a research job. Its tokens and cost as the run reported
 *  them — collagen's own spend, beside what its words cost the agents. Local. */
export const OwnRun = Schema.Struct({
  at: Schema.Finite,
  /** the harness that ran it */
  harness: Schema.String,
  /** what it was for */
  why: Schema.Literals(["wake", "research", "investigation"]),
  model: Schema.optional(Schema.String),
  inputTokens: Schema.Finite,
  outputTokens: Schema.Finite,
  /** in US dollars, as the harness estimates it; absent when it did not say */
  costUsd: Schema.optional(Schema.Finite),
});
export type OwnRun = typeof OwnRun.Type;

/** A job collagen was asked to run and has not finished (cli Jobs): what it
 *  asks of which AI, kept so a restart picks the queue up where it was. A
 *  job that was running when collagen stopped starts again. Local. */
export const QueuedJob = Schema.Struct({
  id: Schema.String,
  kind: JobKind,
  ticketId: Schema.String,
  title: Schema.String,
  harness: Schema.String,
  model: Schema.optional(Schema.String),
  queuedAt: Schema.Finite,
  prompt: Schema.String,
  cwd: Schema.String,
  /** whose doing started it: the person's, or another's investigation that
   *  reached them (their steering for others' then let it run) */
  cause: Schema.optional(Schema.Literals(["mine", "others"])),
});
export type QueuedJob = typeof QueuedJob.Type;

/** Local, per-user state: preferred AI + per-room projects. A project
 *  belongs to the room it was added in (Keet-style) — the same repo shared
 *  into two rooms is two entries. */
/** How much the person's agent may do on its own with what collagen hands
 *  it: ask first, act then tell, or just do it (cli lib/steering). Local —
 *  the person's own setting, never broadcast. */
export const Steering = Schema.Literals(["ask", "act", "auto"]);
export type Steering = typeof Steering.Type;

/** The kinds of thing steered, each with a level of its own under the
 *  master: the work collagen hands the person's agent, acting on the repo
 *  host in their name (reviews, comments, merges — one level for every
 *  host), delivering into their AI conversations, and running their AI for
 *  a job of collagen's (researching a ticket). */
export const SteeringKind = Schema.Literals(["work", "host", "deliver", "run", "investigate"]);
export type SteeringKind = typeof SteeringKind.Type;

/** A level for what the person or their own agents caused, and one for
 *  what another person in the room caused; absent = not chosen. */
export const SteeringPair = Schema.Struct({ mine: Schema.optional(Steering), others: Schema.optional(Steering) });
export type SteeringPair = typeof SteeringPair.Type;

/** Where a message for the person goes: nowhere (they ask for it), a
 *  conversation already holding its thread, that or else a new one, or
 *  always a new one. Whether it goes at all is the deliver level's. */
export const TagRoute = Schema.Literals(["none", "existing", "existing-or-new", "new"]);
export type TagRoute = typeof TagRoute.Type;

/** The person's steering (cli lib/steering): a master level every kind
 *  follows until set, a level per kind, and where a tag goes. Local — the
 *  person's own choice, never broadcast. */
export const SteeringLevels = Schema.Struct({
  master: Schema.optional(SteeringPair),
  kinds: Schema.optional(Schema.Struct({ work: Schema.optional(SteeringPair), host: Schema.optional(SteeringPair), deliver: Schema.optional(SteeringPair), run: Schema.optional(SteeringPair), investigate: Schema.optional(SteeringPair) })),
  tag: Schema.optional(TagRoute),
});
export type SteeringLevels = typeof SteeringLevels.Type;

/** The person's switches (cli lib/settings): each one absent means its
 *  default, so a new one needs no migration. Local, never broadcast. */
export const Settings = Schema.Struct({
  /** absent = on: a review's page opens in the browser when it is started */
  openReviewPage: Schema.optional(Schema.Boolean),
  /** absent = on: closing a ticket, what it grew from (open, the person's
   *  own) is offered ticked to close with it */
  alsoCloseParents: Schema.optional(Schema.Boolean),
});
export type Settings = typeof Settings.Type;

/** Whose approval collagen waits for before it merges the pull request of a
 *  review its person filed (cli lib/merging): never, someone else's, their
 *  own Accept, or both. The host's own rules always come first. */
export const MergeFor = Schema.Literals(["off", "theirs", "mine", "both"]);
export type MergeFor = typeof MergeFor.Type;

/** Merging for the person, in three layers, the narrowest winning: a
 *  review's own, a room's, and the default a room is given when it is
 *  joined. Local, never broadcast. */
export const Merging = Schema.Struct({
  default: Schema.optional(MergeFor),
  rooms: Schema.optional(Schema.Record(Schema.String, MergeFor)),
  tickets: Schema.optional(Schema.Record(Schema.String, MergeFor)),
});
export type Merging = typeof Merging.Type;

/** A theme of the person's own for collagen's pages: daisyUI's variables, named. */
export const PageTheme = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  scheme: Schema.Literals(["light", "dark"]),
  vars: Schema.Record(Schema.String, Schema.String),
});
/** The theme every page wears: the one chosen ("" collagen's own, a daisyUI
 *  theme's name, or "custom:<id>") and the person's own. Local, never
 *  broadcast; any page and the person's agent (set-theme) set it. */
export const PageThemes = Schema.Struct({ chosen: Schema.String, saved: Schema.Array(PageTheme) });
export type PageThemes = typeof PageThemes.Type;

export const LocalState = Schema.Struct({
  preferredAi: Schema.NullOr(Schema.String),
  /** absent = nothing chosen: collagen does nothing outside itself in the
   *  person's name (an older build's bare level is read as the work level) */
  steering: Schema.optional(SteeringLevels),
  /** the conversations already told steering is not chosen (conversation keys, latest last) */
  steeringAsked: Schema.optional(Schema.Array(Schema.String)),
  /** reviews whose pull request the person said yes to merging, asked at
   *  "ask first" — merged once ready, then let go (cli Merger) */
  mergeYes: Schema.optional(Schema.Array(Schema.String)),
  /** messages a conversation of the person's was already woken for (cli
   *  AgentRunner), latest last: each wakes one once, restarts included */
  woken: Schema.optional(Schema.Array(Schema.String)),
  /** job kind → the model the person chose for it (cli lib/jobs); absent = the harness's default */
  models: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  /** how many jobs collagen runs at once; absent = one */
  jobLimit: Schema.optional(Schema.Finite),
  /** jobs asked for and not yet finished, oldest first (see QueuedJob) */
  queuedJobs: Schema.optional(Schema.Array(QueuedJob)),
  /** collagen's own model runs, latest last (see OwnRun) */
  ownRuns: Schema.optional(Schema.Array(OwnRun)),
  settings: Schema.optional(Settings),
  /** absent = never merged for them */
  merging: Schema.optional(Merging),
  /** absent = collagen's own, and none of the person's yet */
  themes: Schema.optional(PageThemes),
  rooms: Schema.Record(Schema.String, Schema.Array(Project)),
  /** roomId → the room's project names in the order the person put them
   *  (cli lib/projectOrder). Local, never broadcast: each person orders
   *  them their own way. */
  projectOrder: Schema.optional(Schema.Record(Schema.String, Schema.Array(Schema.String))),
  /** threadId → the user's adopted conversation for it. */
  threads: Schema.optional(Schema.Record(Schema.String, AdoptedThread)),
  /** roomId → threadId → log position of the last message pulled from the
   *  inbox. Messages live on the room's log; this is what makes "waiting"
   *  a local, per-reader notion that survives restarts. */
  consumed: Schema.optional(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Finite))),
  /** conversation key (conversationKey) → roomId → threadId → the time of the
   *  last message that conversation read there. Each AI conversation keeps
   *  its own place (cli Inbox); `consumed` stays how far anyone has read. */
  reads: Schema.optional(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Finite)))),
  /** What has gone out of here, newest first (see cli Outbox) — a record, not
   *  a queue: nothing waits for approval. */
  sent: Schema.optional(Schema.Array(Proposal)),
  /** Transcript requests waiting on the person's word — asked for by a peer,
   *  never answered by itself. */
  transcriptAsks: Schema.optional(Schema.Array(TranscriptAsk)),
  /** Files we attached to tickets: attachment id → our local path, so a fetch
   *  can be answered (only for ids here — nothing else ever leaves). */
  attachedFiles: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  /** What the person's AI drafted on reviews, waiting on their word: ticket
   *  id → drafts. Never leaves this machine; accepted ones go on the log. */
  drafts: Schema.optional(Schema.Record(Schema.String, Schema.Array(DraftComment))),
  /** The reader's reviews finished from the page: ticket id → the ids of
   *  its latest finishes, so the same finish sent again is not said twice. */
  finished: Schema.optional(Schema.Record(Schema.String, Schema.Array(Schema.String))),
  /** Assumed reviews of this person's own code their agent has been told of
   *  — once each, whenever it arrived. */
  toldGuessed: Schema.optional(Schema.Array(Schema.String)),
  /** conversation key (acting conversationKey) → what that conversation has
   *  worked on here. Local; see Worked. */
  worked: Schema.optional(Schema.Record(Schema.String, Worked)),
});
export type LocalState = typeof LocalState.Type;
