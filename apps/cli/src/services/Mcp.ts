import { statSync } from "node:fs";
import { createServer } from "node:http";
import { basename, resolve } from "node:path";
import { Clock, Effect, Layer, Schema, SubscriptionRef } from "effect";
import { McpProtocol, McpServer, Tool, Toolkit } from "effect/unstable/ai";
import { HttpRouter, HttpServer, HttpServerResponse } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import { encode as toToon } from "@toon-format/toon";
import { AI_OPTIONS, DriveAction, emptyReview, isJudged, isRoomId, isTake, mergeReview, newProject, PROTOCOL_VERSION, retireSteps, reviewStepId, Room, roomProjects, shortRoomId, takeIntent, type Ticket } from "@collagen/p2p";
import { invitedRoomEntry, newRoomEntry, readProfileFile, writeProfileFile } from "../config/profileFile";
import { DiagnosticToolkit, diagnostics } from "../diagnostics";
import { branchLink, branchOf } from "../lib/gitInfo";
import { reviewGaps, type DecisionInput, type ForkInput } from "../lib/review";
import { ticketView } from "../lib/ticketView";
import { MOCK_AI_OPTIONS } from "./Adapters";
import { portForProfile } from "./mcpAddress";
import { CliArgs } from "./CliArgs";
import { IdentityService } from "./Identity";
import { Inbox } from "./Inbox";
import { Scripting } from "./Scripting";
import { Rooms } from "./Rooms";
import { StateStore } from "./StateStore";
import { Outbox } from "./Outbox";
import { Transcripts } from "./Transcripts";
import { Attachments } from "./Attachments";
import { Updates } from "./Updates";
import { McpInfo } from "./McpInfo";

// NOTE: tool results must be OBJECT-rooted — the MCP spec types
// `structuredContent` as an object, and Claude Code rejects array roots.
/** Agent-facing ticket view: pubkeys resolved to peer names, uniform step
 *  rows (so TOON renders them as one compact table). */
export const ListRoom = Tool.make("list-room", {
  description:
    "The room the user is looking at (a stable short id plus its shared name) and the peers in it with the projects each shares; peers marked away are connected but working elsewhere. Call this first to discover who you can contact and about which project. otherRooms is one line per other room the user is in — name, short id, who is online, unread messages — nothing more; use switch-room if a request concerns one of them. Returns TOON (compact YAML/CSV-style) text.",
  // no `parameters`: an empty Schema.Struct({}) produces a JSON schema without
  // "type", which the MCP tool codec rejects at registration
  success: Schema.String,
});

export const SendToPeer = Tool.make("send-to-peer", {
  description:
    "Send what YOUR USER decided to say to a peer in the room, about a specific project. Collagen puts a person between two agents: send only what your user asked you to send — never a reply, a question or findings on your own initiative. It goes to the room as your user asked, and lands in the thread between you two about that project; the peer's agent relays it to its person, who decides what comes back. Use a 'peer' name and 'project' from list-room. 'intent' is a short verb like 'flag-issue' or 'ask-review'. 'findings' is the text as it should arrive: the context your user wants shared plus what they want from the other side. When your user weighs in on a ticket (anyone in the room may, asked or not), pass its 'ticketId' (from get-tickets) so it shows on that ticket for everyone.",
  parameters: Schema.Struct({
    peer: Schema.String,
    project: Schema.String,
    intent: Schema.String,
    findings: Schema.String,
    ticketId: Schema.optional(Schema.String),
  }),
  success: Schema.String,
});

export const PendingThreads = Tool.make("pending-threads", {
  description:
    "List the conversation threads that have messages waiting for you, without consuming them. Each row is one thread: its threadId, who it's from, the project, how many messages are queued, and the latest intent. Call this first to see what's waiting, then pull a specific thread with get-messages. Returns TOON (compact YAML/CSV-style) text.",
  success: Schema.String,
});

export const WatchRoom = Tool.make("watch-room", {
  description:
    "How to stay responsive to room messages WITHOUT blocking your conversation — call this once and follow the instructions for your harness. Pass which harness you are running in: 'claude-code' (you get a background-watcher recipe: events arrive while the user keeps chatting), 'codex' (adopt threads and collagen queues messages directly into your session), or 'other' (polling fallback). This tool changes nothing by itself; it returns setup instructions.",
  parameters: Schema.Struct({
    harness: Schema.Literals(["claude-code", "codex", "other"]),
  }),
  success: Schema.String,
});

export const AwaitMessages = Tool.make("await-messages", {
  description:
    "Wait for the next incoming room message: this call BLOCKS until a message arrives (returning the pending threads immediately) or until `seconds` elapse (returning a keep-waiting note). This is how you watch the room from any harness — while you have nothing else to do, call await-messages in a loop: handle what it returns (get-messages → act → send-to-peer), then call it again. Waiting costs nothing. Default 55 seconds; raise it only if your harness allows longer tool calls, lower it if it times out.",
  parameters: Schema.Struct({
    seconds: Schema.optional(Schema.Finite),
  }),
  success: Schema.String,
});

export const AdoptThread = Tool.make("adopt-thread", {
  description:
    "Link a collagen thread to YOUR OWN conversation in your agent harness, so new messages on it resume that conversation (claude --resume / codex exec resume) instead of waiting in the inbox — the full loop with no manual pulling. 'threadId' is collagen's thread id (from pending-threads or a message you were handed) — it is derived by collagen and can never be chosen or changed. 'sessionId' is the id of your conversation IN THE HARNESS: the Claude Code session id, or the codex thread id. This only stores a mapping; it does not alter any collagen ids. Adoption persists across restarts. Adopt only your own conversation.",
  parameters: Schema.Struct({
    threadId: Schema.String,
    agent: Schema.Literals(["claude-code", "codex"]),
    sessionId: Schema.String,
  }),
  success: Schema.String,
});

export const GetMessages = Tool.make("get-messages", {
  description:
    "Read the messages waiting in one thread, when your user asks what a peer said or wants more than the headline. Pass the threadId (from pending-threads, or from the message you were handed). Each message includes the sender, project, intent, and findings — written by a person, through their agent. Relay what is there; never fill gaps from your own head. Do not answer, investigate or act on a message on your own: the person on this side decides. If they then ask something the thread does not answer, either it is theirs to answer from this repo under their direction, or it is the peer's — then send that question with send-to-peer (same peer and project keeps it in this thread), in their words. Reading marks the thread as seen.",
  parameters: Schema.Struct({
    threadId: Schema.String,
  }),
  success: Schema.String,
});

export const ExecuteScript = Tool.make("execute", {
  description:
    "Run a CallScript program against collagen's tools (collagen.listRoom, collagen.sendToPeer, collagen.getMessages). Write a small JS program — it is compiled to an inert plan, never executed as code — to compose several collagen calls in one shot (e.g. list the room, then fan a message out to every peer sharing a project). Call describe-scripting first for the language card and tool signatures.",
  parameters: Schema.Struct({
    script: Schema.String,
    input: Schema.optional(Schema.Unknown),
  }),
  success: Schema.Record(Schema.String, Schema.Unknown),
});

export const SearchTools = Tool.make("search-tools", {
  description: "Search the tools mounted on the CallScript engine by keyword.",
  parameters: Schema.Struct({ query: Schema.String }),
  success: Schema.Struct({ matches: Schema.String }),
});

export const DescribeScripting = Tool.make("describe-scripting", {
  description:
    "The CallScript language card plus the signatures of every mounted collagen tool. Read this before writing a script for the execute tool.",
  success: Schema.Struct({ card: Schema.String }),
});

export const CreateTicket = Tool.make("create-ticket", {
  description:
    "Create a shared ticket your user asked for: a structured record of a cross-peer task that every peer in the room holds a merged copy of. Only when your user wants one — never on your own initiative. It reaches the room at once, and the collagen TUI's outbox shows them what went. Steps name an owner (a peer name from list-room, or yourself), an intent verb, a full description, and optional 'needs' (ids of steps that must settle first). When a step becomes actionable (its needs settled), it is delivered to its owner as a message on the thread between you and them about this project; the owner's agent relays it to its person, who decides whether and how it gets done and settles it with settle-step, which unblocks the next steps. Want a review gate? Add a final step you own that needs the work step. Prefer this over a chain of send-to-peer for multi-step work — the intermediate state stays inspectable by everyone.",
  parameters: Schema.Struct({
    goal: Schema.String,
    /** tickets this one follows — a plan it carries out; walked back on request */
    from: Schema.optional(Schema.Array(Schema.String)),
    /** your user's instruction for the moment they close it, handed back then */
    whenClosed: Schema.optional(Schema.String),
    project: Schema.String,
    steps: Schema.Array(
      Schema.Struct({
        id: Schema.optional(Schema.String),
        owner: Schema.String,
        intent: Schema.String,
        description: Schema.String,
        needs: Schema.optional(Schema.Array(Schema.String)),
      }),
    ),
  }),
  success: Schema.String,
});

/** The parameters a plan and a proposal share with a review, minus the code
 *  facts: the question (goal), the author's thoughts (decisions) and the
 *  forks to come, who is asked, what follows from what, and what to do when
 *  it is closed. */
const judgedParameters = {
  peers: Schema.optional(Schema.Array(Schema.String)),
  project: Schema.optional(Schema.String),
  ticketId: Schema.optional(Schema.String),
  goal: Schema.optional(Schema.String),
  summary: Schema.optional(Schema.String),
  focus: Schema.optional(Schema.String),
  from: Schema.optional(Schema.Array(Schema.String)),
  whenClosed: Schema.optional(Schema.String),
  decisions: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.optional(Schema.String),
        what: Schema.String,
        userWhy: Schema.optional(Schema.String),
        agentWhy: Schema.optional(Schema.String),
        where: Schema.optional(Schema.Array(Schema.String)),
      }),
    ),
  ),
  forks: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.optional(Schema.String),
        at: Schema.String,
        chose: Schema.String,
        instead: Schema.String,
        why: Schema.String,
        by: Schema.optional(Schema.Literals(["user", "agent"])),
      }),
    ),
  ),
};

/** A work item's stable id: the one the agent gave, else its intent. Two items
 *  that would share one is a refusal, not a silent overwrite. */
const workId = (w: { readonly id?: string; readonly intent: string }): string => (w.id ?? w.intent).trim().replace(/\s+/g, "-");
/** A work step's id on the ticket: its own namespace, so no work item can
 *  land on a take step ("review-bob") or the author's "address" — the same
 *  function at creation, amendment and retirement, or they drift. */
const workStepId = (id: string, reader: string): string => `work-${id}-${reader}`;
const duplicateWorkId = (work: ReadonlyArray<{ readonly id?: string; readonly intent: string }>): string | null => {
  const seen = new Set<string>();
  for (const w of work) {
    const id = workId(w);
    if (seen.has(id)) return id;
    seen.add(id);
  }
  return null;
};

export const AskPlan = Tool.make("ask-plan", {
  description: [
    "File a PLAN: something your user intends to do, put to the room for judgment before it is built — do you agree, what would you change, what am I missing. Only when your user asks for input, advice or direction on what they mean to do (\"ask kristian what he thinks of this plan\", \"put this up for input\") — never on your own initiative. It reaches the room at once and the outbox shows what went. A question your user could have asked YOU is not a plan: this is for a colleague's judgment, the input that is not AI.",
    "'goal' is the one line everyone sees — what your user intends (\"stream the export, don't buffer it\"). 'summary' is their thinking in a paragraph. 'decisions' are the thoughts behind it, one per point: 'what' they mean to do, 'userWhy' in their words, 'agentWhy' what you found, checked or would add — marked as yours. 'forks' are the roads not taken so far, with 'at' as a pointer where there is code, or the area if there is none yet. 'peers' is 0 to many, exactly the names your user said; nobody named means the plan sits in the room for whoever has a take — including your user's own second agent.",
    "Readers give a BLIND FIRST TAKE: their agent hands them the goal alone, they say what they think (post-review; failed: true asks for changes), and only then do your user's thoughts open to them. A ↻ hands the plan back to your user to revise this same ticket (ask-plan with 'ticketId'), never to reply in prose. 'from' names tickets this plan follows (a proposal it answers); 'whenClosed' is your user's own instruction for the moment they close it (\"open the Jira tickets\"), handed back to you then.",
    "WHAT TO TELL YOUR USER: that the plan ticket has been filed (or updated), nothing more. KEEP IT CURRENT: when their thinking moves, call ask-plan again with 'ticketId' — re-send the summary if it no longer holds, repeat the id of a changed decision, pass a new 'goal' if the question moved; 'from: []' withdraws the lineage and 'whenClosed: \"\"' the close instruction, leaving either out keeps it. When the takes are in and your user has decided, close-ticket with the conclusion as the reason.",
  ].join("\n"),
  parameters: Schema.Struct(judgedParameters),
  success: Schema.String,
});

export const Propose = Tool.make("propose", {
  description: [
    "File a PROPOSAL: work your user wants SOMEONE ELSE to do, with the why attached — will you do this. Only when your user asks you to propose it to a named person (\"propose to kristian that the backend streams the export\") — never on your own initiative. Not a task: a task is agreed work with owners; a proposal asks first, and the recipient owes nothing until they say yes.",
    "'peers' is who is asked — 1 or more, exactly the names your user said. 'goal' is the one line everyone sees. 'summary', 'decisions' (the why: 'userWhy' in your user's words, 'agentWhy' yours) and 'forks' as for ask-plan. 'work' is what they are being asked to do: steps, each an 'id' (stable — give one whenever two items could share an intent; it defaults to the intent), an intent and a description; every recipient gets those steps, waiting on their own ✓ — a ↻ hands the proposal back to your user to revise this same ticket (propose with 'ticketId'). 'from' names tickets this follows; 'whenClosed' is your user's instruction for the moment they close it.",
    "REVISING (propose with 'ticketId'): 'work' updates a pending step's text by id and adds new ids as new steps; nothing is ever removed by omission. To withdraw work, pass 'retireWork' with the ids — those steps are retired: kept on the ticket as history, never actionable, and what a recipient already settled or failed is left as it is. 'from: []' withdraws the lineage and 'whenClosed: \"\"' withdraws the close instruction; leaving either out leaves it as it was.",
    "Readers give a BLIND FIRST TAKE (see ask-plan). WHAT TO TELL YOUR USER: that the proposal has been filed (or updated), nothing more. KEEP IT CURRENT with propose and 'ticketId'. When the work is done or declined and your user is done with it, close-ticket with the conclusion as the reason.",
  ].join("\n"),
  parameters: Schema.Struct({
    ...judgedParameters,
    work: Schema.optional(Schema.Array(Schema.Struct({ id: Schema.optional(Schema.String), intent: Schema.String, description: Schema.String }))),
    retireWork: Schema.optional(Schema.Array(Schema.String)),
  }),
  success: Schema.String,
});

export const AskReview = Tool.make("ask-review", {
  description: [
    "Ask for a review of your user's code, with the WHY attached — the thing a diff cannot show. Only when your user asks for a review (\"ask <peer> for a review\", \"put it up for review\") — never on your own initiative. It reaches the room at once, and the collagen TUI's outbox shows them what went, in full.",
    "'peers' is who is asked, and it is 0 to many — it carries exactly the names your user said, and NONE is the default. They named nobody, you name nobody: never infer a reviewer from who is in the room, who is online, or who touched the code. Name several and each gets a review step of their own. With nobody asked the ticket sits in the room with the why on it for whoever reads it — another peer, or your user's own second agent — and nothing is pushed to anyone. Reviews are posted with post-review, one step per reader, so a second and a third reader can review the same change.",
    "Before calling, read back over THIS conversation and mine it: for each decision behind the change, what your user asked for, prefaced, or ruled out ('userWhy' — their words where you have them) and your own reason for the shape it took ('agentWhy'), plus 'where' it landed (file, or file:line). Then every fork in the road: a point where you could have gone one way and went the other — 'at' (file:line of the code the choice produced), 'chose', 'instead', 'why', and 'by' (\"user\" if they made the call, \"agent\" if you did). Enough for the reviewer to judge the turn, not an essay. Pass forks as [] only when there genuinely were none.",
    "'branch', 'base' and 'link' are read from the project's git when you omit them (a pull request link is better than the branch link collagen can derive). 'focus' is what your user wants looked at.",
    "It creates a review ticket: a step per person asked (their review) and one you own (acting on what comes back). The why goes on the room's log beside it, so it is there when you are offline — and a reader's agent pulls it only when their person asks.",
    "WHAT TO TELL YOUR USER: that the review ticket has been filed (or updated), and nothing more. They asked for it, so do not read the summary, the decisions, the forks or their counts back to them — the ticket carries all of it for whoever reviews it, and their TUI shows the ticket.",
    "KEEP IT CURRENT. A review is not a snapshot: your user will change the code, before or after anyone reads it. Whenever they do, call ask-review again with 'ticketId' — add a decision for what changed and why (their words for it), correct a decision that no longer holds by repeating its id, and pass the new 'branch' or 'link' if the code moved. Everyone reading the ticket is told it was revised, so what they review is what exists. When your user has acted on the feedback, settle your own step with settle-step; if the review was open, settling it closes the invitation.",
  ].join("\n"),
  parameters: Schema.Struct({
    peers: Schema.optional(Schema.Array(Schema.String)),
    project: Schema.optional(Schema.String),
    ticketId: Schema.optional(Schema.String),
    goal: Schema.optional(Schema.String),
    summary: Schema.optional(Schema.String),
    focus: Schema.optional(Schema.String),
    branch: Schema.optional(Schema.String),
    base: Schema.optional(Schema.String),
    link: Schema.optional(Schema.String),
    from: Schema.optional(Schema.Array(Schema.String)),
    whenClosed: Schema.optional(Schema.String),
    decisions: Schema.optional(
      Schema.Array(
        Schema.Struct({
          id: Schema.optional(Schema.String),
          what: Schema.String,
          userWhy: Schema.optional(Schema.String),
          agentWhy: Schema.optional(Schema.String),
          where: Schema.optional(Schema.Array(Schema.String)),
        }),
      ),
    ),
    forks: Schema.optional(
      Schema.Array(
        Schema.Struct({
          id: Schema.optional(Schema.String),
          at: Schema.String,
          chose: Schema.String,
          instead: Schema.String,
          why: Schema.String,
          by: Schema.optional(Schema.Literals(["user", "agent"])),
        }),
      ),
    ),
  }),
  success: Schema.String,
});

export const PostReview = Tool.make("post-review", {
  description: [
    "Put your user's review of a review ticket on that ticket — what they think of the change, in their words. For a review they were asked for AND for one they were not: anyone in the room may read a review ticket, and each reader's review lands on a step of their own, so nobody takes anything from anyone. Posting again revises your user's own review.",
    "Only when your user has said what they think — never your own reading of the code, and never a summary you produced on your own initiative. Read the why first (review-context) so the review answers the reasons and not just the diff. It goes out as you call it, like everything else that leaves this machine, and shows in your user's outbox; set 'failed' when they are rejecting the change rather than commenting on it.",
  ].join("\n"),
  parameters: Schema.Struct({
    ticketId: Schema.String,
    findings: Schema.String,
    failed: Schema.optional(Schema.Boolean),
  }),
  success: Schema.String,
});

export const SettleStep = Tool.make("settle-step", {
  description:
    "Settle (or fail) a ticket step your user owns, with the result they want to send — only when they say the step is done (or declined), never because you decided it is. The updated ticket is broadcast to the room at once, and steps waiting on this one become actionable and are delivered to their owners (as messages on the ticket creator's thread with them). A step belongs to the person who owns it: settling someone else's is refused on any ticket — to say what your user thinks of a change, use post-review (a review ticket) or send-to-peer with its ticketId.",
  parameters: Schema.Struct({
    ticketId: Schema.String,
    stepId: Schema.String,
    result: Schema.String,
    failed: Schema.optional(Schema.Boolean),
  }),
  success: Schema.String,
});

export const CloseTicket = Tool.make("close-ticket", {
  description:
    "Close a ticket your user created — only when they say they are done with it, never because you decided it is over. Closing is the author's decision, separate from completion: a ticket whose every step is answered is READY to close (settle-step tells you so), but the person closes it; and they may close one whose reviewer never answered or whose work was abandoned. The ticket leaves the overview and stays on the room's log with its steps exactly as they were, so later tickets can still refer to it; get-tickets keeps showing it with closed: true. Pass 'reason' when the close needs explaining (abandoned, superseded, done differently) — it goes on the record. Somebody else's ticket is refused: say what your user thinks with send-to-peer instead.",
  parameters: Schema.Struct({
    ticketId: Schema.String,
    reason: Schema.optional(Schema.String),
  }),
  success: Schema.String,
});

export const DrivePeer = Tool.make("drive-peer", {
  description:
    "TESTING ONLY: remote-control a mock peer (one whose ai starts with 'mock:') so a single machine can exercise the full cross-peer flow. The driven peer performs the action as itself, so everything arrives back through the real pipeline. 'action' is the action object, tagged by 'kind': {kind:'send-message', project, intent, findings, ticketId?} (the peer sends YOU a message; reusing a project continues the same thread), {kind:'create-ticket', project, goal, steps:[{intent, description, mine}]} (mine=true → the mock owns the step, mine=false → you own it and your agent is triggered), {kind:'settle-step', ticketId, stepId, result} (the peer settles a step it owns), {kind:'post-review', ticketId, result, failed?} (the peer puts its review on a review ticket; failed:true asks for changes). Real peers ignore drive requests.",
  // the action IS the domain's DriveAction — one schema, so a new kind can
  // never be missing here (it used to be a hand-copied enum, and a kind added
  // to the union was silently rejected at this boundary)
  parameters: Schema.Struct({ peer: Schema.String, action: DriveAction }),
  success: Schema.String,
});

// ── settings on behalf of the user ──────────────────────────────────────────
// Anything a person can configure, an agent can configure for them. UI state
// (tabs, focus) is deliberately NOT here.

export const AddProject = Tool.make("add-project", {
  description:
    "Share a local project folder into the CURRENT room on behalf of the user. 'path' must be an existing directory (absolute, or relative to the agent's cwd); 'name' defaults to the folder name. Applies live — peers see it at once and can message about it.",
  parameters: Schema.Struct({ path: Schema.String, name: Schema.optional(Schema.String) }),
  success: Schema.String,
});

export const RemoveProject = Tool.make("remove-project", {
  description: "Stop sharing one of the user's projects in the current room, by name. Applies live.",
  parameters: Schema.Struct({ name: Schema.String }),
  success: Schema.String,
});

export const SetAi = Tool.make("set-ai", {
  description:
    "Set which agent CLI acts for this user: 'claude-code', 'codex', a mock ('mock:claude-code' / 'mock:codex' — test dummies, visibly labeled to peers), or 'none' (inbox mode: nothing ever auto-runs; messages wait to be pulled). Applies live; peers see the choice and its auth status.",
  parameters: Schema.Struct({ ai: Schema.Literals([...AI_OPTIONS, ...MOCK_AI_OPTIONS, "none"]) }),
  success: Schema.String,
});

export const SetName = Tool.make("set-name", {
  description: "Change the user's display name as peers see it. Applies live.",
  parameters: Schema.Struct({ name: Schema.String }),
  success: Schema.String,
});

export const RenameRoom = Tool.make("rename-room", {
  description: "Rename the CURRENT room for everyone in it (the name is shared state, broadcast last-writer-wins). Applies live.",
  parameters: Schema.Struct({ name: Schema.String }),
  success: Schema.String,
});

export const ListRooms = Tool.make("list-rooms", {
  description:
    "Every room this user is in, one line each: stable short id, shared name, who is online, unread messages waiting there, whether it is the one being looked at, and the invite id (the secret a friend needs to join — share it only when the user asks). Returns TOON text.",
  success: Schema.String,
});

export const CreateRoom = Tool.make("create-room", {
  description:
    "Create a new room for the user, join it live and look at it. Returns the invite id to share with friends.",
  parameters: Schema.Struct({ name: Schema.String }),
  success: Schema.String,
});

export const JoinRoom = Tool.make("join-room", {
  description:
    "Join a friend's room from its invite id (a uuid the friend copied with c), live, and look at it. Optional 'name' is a local label until the room's shared name arrives.",
  parameters: Schema.Struct({ inviteId: Schema.String, name: Schema.optional(Schema.String) }),
  success: Schema.String,
});

export const SwitchRoom = Tool.make("switch-room", {
  description:
    "Look at (work in) another of the user's rooms, by short id, name, or invite id — see list-rooms. Instant: the user is then present there and away everywhere else; all other tools now refer to that room.",
  parameters: Schema.Struct({ room: Schema.String }),
  success: Schema.String,
});

export const LeaveRoom = Tool.make("leave-room", {
  description:
    "Leave one of the user's rooms, by short id, name, or invite id — see list-rooms. Local: the user stops taking part and the room disappears from their list; the other members keep the room and its history. Refused for the user's only room. Only do this when the user asks.",
  parameters: Schema.Struct({ room: Schema.String }),
  success: Schema.String,
});

export const GetTickets = Tool.make("get-tickets", {
  description:
    "All shared tickets in the room the user is looking at, merged: goal, steps with owner, status, dependencies and settled results. Read it when your user asks about a ticket or wants the steps behind a headline — relay what is there, never fill gaps from your own head. Returns TOON (compact YAML/CSV-style) text.",
  success: Schema.String,
});

export const CollagenToolkit = Toolkit.make(
  ListRoom,
  SendToPeer,
  PendingThreads,
  GetMessages,
  AwaitMessages,
  AdoptThread,
  WatchRoom,
  ExecuteScript,
  SearchTools,
  DescribeScripting,
  CreateTicket,
  AskReview,
  AskPlan,
  Propose,
  PostReview,
  SettleStep,
  CloseTicket,
  GetTickets,
  AddProject,
  RemoveProject,
  SetAi,
  SetName,
  RenameRoom,
  ListRooms,
  CreateRoom,
  JoinRoom,
  SwitchRoom,
  LeaveRoom,
);

/** Dev-only surface: everything plus the drive-peer test tool. A prod run
 *  never registers it — the tool doesn't exist there, it isn't just refused. */
export const DevCollagenToolkit = Toolkit.make(
  ListRoom,
  SendToPeer,
  PendingThreads,
  GetMessages,
  AwaitMessages,
  AdoptThread,
  WatchRoom,
  ExecuteScript,
  SearchTools,
  DescribeScripting,
  CreateTicket,
  AskReview,
  AskPlan,
  Propose,
  PostReview,
  SettleStep,
  CloseTicket,
  GetTickets,
  AddProject,
  RemoveProject,
  SetAi,
  SetName,
  RenameRoom,
  ListRooms,
  CreateRoom,
  JoinRoom,
  SwitchRoom,
  LeaveRoom,
  DrivePeer,
);

const makeHandlers = Effect.gen(function* () {
    const rooms = yield* Rooms;
    const updates = yield* Updates;
    const store = yield* StateStore;
    const mcpInfo = yield* McpInfo;
    const { profile } = yield* CliArgs;
    const inbox = yield* Inbox;
    const outbox = yield* Outbox;
    const scripting = yield* Scripting;
    const { identity, nameRef, setName } = yield* IdentityService;

    // Every tool is scoped to the room the user is looking at — resolved per
    // call, so switching rooms retargets all of them without a reconnect.
    const focusedRoom = Effect.gen(function* () {
      const h = yield* rooms.current;
      const meta = yield* SubscriptionRef.get(h.room.meta);
      return { id: h.id, name: meta.name, room: h.room };
    });

    const renderTicket = Effect.fnUntraced(function* (ticket: Ticket) {
      const { room } = yield* focusedRoom;
      const peers = yield* SubscriptionRef.get(room.roster);
      const members = yield* SubscriptionRef.get(room.members);
      const myName = yield* SubscriptionRef.get(nameRef);
      const lookup = (key: string) =>
        key === identity.pubkey
          ? myName
          : (peers.find((p) => p.key === key)?.name ?? members.find((m) => m.key === key)?.name ?? key.slice(0, 12));
      const reviews = yield* SubscriptionRef.get(room.reviews);
      return ticketView(ticket, lookup, reviews.find((r) => r.ticketId === ticket.id));
    });

    const sendToPeer = Effect.fn("Mcp.sendToPeer")(function* (input: {
      peer: string;
      project: string;
      intent: string;
      findings: string;
      ticketId?: string;
    }) {
      const { id: roomId, room } = yield* focusedRoom;
      // present peers first; then anyone the log remembers (they read it when back)
      const peers = yield* SubscriptionRef.get(room.roster);
      const members = yield* SubscriptionRef.get(room.members);
      if (!peers.some((p) => p.name === input.peer) && !members.some((m) => m.name === input.peer)) {
        return `failed: no peer named ${input.peer} — see list-room`;
      }
      // Outbox → Dispatch: it goes now, and is recorded as having gone
      return yield* outbox.tell({
        roomId,
        to: input.peer,
        title: `${input.project} · ${input.intent}`,
        outgoing: {
          kind: "message",
          peer: input.peer,
          project: input.project,
          intent: input.intent,
          findings: input.findings,
          ...(input.ticketId ? { ticketId: input.ticketId } : {}),
        },
      });
    });

    const roomLines = Effect.gen(function* () {
      const all = yield* rooms.summaries;
      const f = readProfileFile(profile);
      return all.map((r) => ({
        shortId: r.shortId,
        name: r.name,
        online: r.online,
        unread: r.unread,
        lookingAt: r.focused,
        inviteId: f.rooms?.find((x) => x.id === r.id)?.id ?? r.id,
      }));
    });

    /** One filing path for every kind that asks for judgment. A review, a
     *  plan and a proposal share the record (the why, with a tense) and the
     *  mechanics (a take per reader on a step of their own, an address step
     *  the author settles); what differs — code facts read from git, work
     *  steps for a recipient, the words a reader's agent is handed — turns on
     *  `kind` here, in one place, instead of three copies drifting apart. */
    const fileJudged = Effect.fn("Mcp.fileJudged")(function* (kind: "review" | "plan" | "proposal", input: {
        peers?: ReadonlyArray<string>;
        project?: string;
        ticketId?: string;
        goal?: string;
        summary?: string;
        focus?: string;
        branch?: string;
        base?: string;
        link?: string;
        decisions?: ReadonlyArray<DecisionInput>;
        forks?: ReadonlyArray<ForkInput>;
      
        from?: ReadonlyArray<string>;
        whenClosed?: string;
        work?: ReadonlyArray<{ readonly id?: string; readonly intent: string; readonly description: string }>;
        retireWork?: ReadonlyArray<string>;
      }) {
        const { id: roomId, room } = yield* focusedRoom;
        const myName = yield* SubscriptionRef.get(nameRef);
        const now = yield* Clock.currentTimeMillis;
        const delta = {
          ...(input.summary ? { summary: input.summary } : {}),
          ...(input.base ? { base: input.base } : {}),
          decisions: input.decisions ?? [],
          forks: input.forks ?? [],
        };

        // amending a review already on a ticket: only its author writes it
        if (input.ticketId) {
          const ticket = (yield* SubscriptionRef.get(room.tickets)).get(input.ticketId);
          if (!ticket) return `failed: no ticket ${input.ticketId} — check get-tickets`;
          // a why belongs to a judged ticket of the same kind: hanging one on a
          // task would leave context nobody can read back (post-review refuses it)
          if (ticket.kind !== kind) {
            return `failed: ticket ${input.ticketId} is a ${ticket.kind}, not a ${kind} — "${ticket.goal}". Leave ticketId out to file a new ${kind}, or pass the right ticket's id.`;
          }
          const existing = (yield* SubscriptionRef.get(room.reviews)).find((r) => r.ticketId === input.ticketId);
          if (existing && existing.author !== identity.pubkey) {
            return `failed: that review's why is ${existing.authorName}'s to write — your user's own reading of the code goes to them with send-to-peer (pass ticketId so it lands on the ticket)`;
          }
          // an amendment may move the why, the ticket, or both — but not nothing
          const whyMoves = delta.decisions.length > 0 || delta.forks.length > 0 || !!input.summary || !!input.branch || !!input.link || !!input.base;
          const ticketMoves =
            input.goal !== undefined ||
            input.from !== undefined ||
            input.whenClosed !== undefined ||
            (input.work?.length ?? 0) > 0 ||
            (input.retireWork?.length ?? 0) > 0 ||
            (input.peers?.length ?? 0) > 0;
          if (!whyMoves && !ticketMoves) return "failed: nothing to amend — pass the decisions, forks or fields you are adding";
          if (whyMoves) {
            const gap = reviewGaps({ ...delta, branch: input.branch, link: input.link }, true);
            if (gap) return gap;
          }
          const review = mergeReview(existing ?? emptyReview(input.ticketId, identity.pubkey, myName), {
            ...delta,
            ...(input.branch ? { branch: input.branch } : {}),
            ...(input.link ? { link: input.link } : {}),
          }, now);
          const present = yield* SubscriptionRef.get(room.roster);
          const known = yield* SubscriptionRef.get(room.members);
          const nameOf = (o: string) => present.find((p) => p.key === o)?.name ?? known.find((m) => m.key === o)?.name;

          // "revise the same ticket" has to mean the TICKET too, not only the
          // why behind it: a recipient who asked for changes to a proposal's
          // work is asking for different steps. Takes and settled work are
          // history and stay as they are; what can move is the goal, the
          // lineage, the close instruction, the pending work, and who is asked.
          let revised: Ticket = ticket;
          if (input.goal && input.goal !== ticket.goal) revised = { ...revised, goal: input.goal };
          // present means set — and an empty value means withdraw; absent means keep
          if (input.from !== undefined) revised = { ...revised, from: input.from };
          if (input.whenClosed !== undefined) revised = { ...revised, whenClosed: input.whenClosed };
          const newReaders = (input.peers ?? [])
            .map((n) => n.trim())
            .filter((n) => n.length > 0)
            .map((name) => ({ name, key: (present.find((p) => p.name === name) ?? known.find((m) => m.name === name))?.key }));
          const unknownReader = newReaders.find((r) => r.key === undefined);
          if (unknownReader) return `failed: no peer named ${unknownReader.name} — see list-room`;
          const takenNow = new Map(revised.steps.map((s) => [s.id, s.owner]));
          for (const r of newReaders) {
            if (r.key === undefined || r.key === identity.pubkey || revised.steps.some((s) => isTake(s) && s.owner === r.key)) continue;
            const id = reviewStepId(r.name, r.key, takenNow);
            takenNow.set(id, r.key);
            revised = {
              ...revised,
              steps: [
                ...revised.steps.map((s) => (s.id === "address" ? { ...s, needs: [...s.needs, id], updatedAt: now } : s)),
                { id, owner: r.key, intent: takeIntent(kind), description: `${r.name}'s ${kind === "review" ? "review" : "take"} on ${revised.goal}`, needs: [], status: "pending" as const, updatedAt: now },
              ],
            };
          }
          if (kind === "proposal" && input.work && input.work.length > 0) {
            const dup = duplicateWorkId(input.work);
            if (dup) return `failed: two work items would share the id "${dup}" — give each its own 'id' (they default to the intent)`;
            const takes = revised.steps.filter((s) => isTake(s));
            const steps = [...revised.steps];
            for (const take of takes) {
              const who = take.id.slice("review-".length);
              for (const w of input.work) {
                const id = workStepId(workId(w), who);
                const at = steps.findIndex((s) => s.id === id);
                if (at < 0) steps.push({ id, owner: take.owner, intent: w.intent, description: w.description, needs: [take.id], status: "pending" as const, updatedAt: now });
                else if (steps[at]!.status === "pending" || steps[at]!.status === "suspended") steps[at] = { ...steps[at]!, intent: w.intent, description: w.description, updatedAt: now };
                // settled, failed or retired work is what happened; a revision does not rewrite it
              }
            }
            revised = { ...revised, steps };
          }
          // withdrawing work is explicit: the ids, applied to every recipient's copy
          if (kind === "proposal" && input.retireWork && input.retireWork.length > 0) {
            const takes = revised.steps.filter((s) => isTake(s));
            const ids = takes.flatMap((take) => input.retireWork!.map((w) => workStepId(w.trim().replace(/\s+/g, "-"), take.id.slice("review-".length))));
            const done = retireSteps(revised, ids, identity.pubkey, now);
            if (done.outcome === "not-yours") return `failed: "${ticket.goal}" is not your user's ticket to revise`;
            if (done.retired.length === 0) return `failed: none of ${input.retireWork.join(", ")} is pending work on this proposal${done.kept.length > 0 ? ` (${done.kept.join(", ")} already answered — that stands)` : ""}`;
            revised = done.ticket;
          }
          const changed = revised !== ticket;
          // the author's clock only ever moves forward, even inside one millisecond
          if (changed) revised = { ...revised, structureAt: Math.max(now, ticket.structureAt + 1), updatedAt: now };

          const owners = [...new Set(revised.steps.map((s) => s.owner).filter((o) => o !== identity.pubkey))];
          const named = owners.map(nameOf).filter((n): n is string => n !== undefined);
          const to = named.length > 0 ? named.join(", ") : "the room";
          return yield* outbox.tell({
            roomId,
            to,
            title: `${revised.goal} · ${changed ? "revised" : "more why"}`,
            outgoing: { kind: "review", ...(changed ? { ticket: revised } : {}), review },
          });
        }

        // a new review: who is asked (0 to many), which project, and the why
        if (!input.project) return "failed: pass 'project' (from list-room), and 'peers' if your user has someone in mind — or 'ticketId' to add to a review you already asked for";
        const peers = yield* SubscriptionRef.get(room.roster);
        const members = yield* SubscriptionRef.get(room.members);
        const asked = [...new Set((input.peers ?? []).map((n) => n.trim()).filter((n) => n.length > 0))];
        const resolved = asked.map((name) => ({ name, key: (peers.find((p) => p.name === name) ?? members.find((m) => m.name === name))?.key }));
        const unknown = resolved.filter((r) => r.key === undefined).map((r) => r.name);
        // narrowed once, so nothing downstream needs a `!`
        const reviewers = resolved.flatMap((r) => (r.key === undefined ? [] : [{ name: r.name, key: r.key }]));
        if (unknown.length > 0) return `failed: no peer named ${unknown.join(", ")} — see list-room${kind === "proposal" ? "" : ` (or leave 'peers' out to open the ${kind} to whoever picks it up)`}`;
        if (reviewers.some((r) => r.key === identity.pubkey)) {
          return `failed: a ${kind} goes to someone other than your user${kind === "proposal" ? "" : " — leave 'peers' out to open it to whoever picks it up, including their own second agent"}`;
        }
        // a proposal asks someone to DO something: it needs them named, and the work spelled out
        if (kind === "proposal" && reviewers.length === 0) return "failed: a proposal is work your user wants someone else to do — pass 'peers' (who), from list-room";
        if (kind === "proposal" && (input.work ?? []).length === 0) return "failed: a proposal needs 'work': the steps your user is asking them to do, each an intent and a description";
        const dupWork = duplicateWorkId(input.work ?? []);
        if (dupWork) return `failed: two work items would share the id "${dupWork}" — give each its own 'id' (they default to the intent)`;
        if (kind !== "review" && !input.goal) return `failed: pass 'goal' — the one line everyone sees: ${kind === "plan" ? "what your user intends to do" : "what your user is asking them to do"}`;
        const project = roomProjects(yield* store.get, roomId).find((p) => p.name === input.project);
        if (!project) {
          const mine = roomProjects(yield* store.get, roomId).map((p) => p.name).join(", ");
          return `failed: "${input.project}" is not a project your user shares in this room (theirs: ${mine || "none"}) — add-project shares one`;
        }
        const gap = reviewGaps({ ...delta, branch: input.branch, link: input.link }, false);
        if (gap) return gap;
        // the facts about the code come from the repo when the agent omits them
        // — for a review; a plan or a proposal has no code yet unless the agent says so
        const branch = kind === "review" ? (input.branch ?? branchOf(project.path) ?? undefined) : input.branch;
        const link = kind === "review" ? (input.link ?? (branch ? (branchLink(project.path, branch) ?? undefined) : undefined)) : input.link;
        const ticketId = crypto.randomUUID();
        const goal = input.goal ?? `review ${branch ?? input.project}`;
        const where = [branch ? `branch ${branch}${input.base ? ` off ${input.base}` : ""}` : "", link ?? ""].filter((x) => x.length > 0).join(" · ");
        // A step per person asked — and only people: a review nobody was asked
        // for has no placeholder step, it is simply a ticket with the why on
        // it, and each reader's review appears as their own step when they
        // post it (post-review).
        const taken = new Map<string, string>();
        const describe = () =>
          [
            input.summary ?? goal,
            where,
            input.focus ? `what your user wants looked at: ${input.focus}` : "",
            kind === "review"
              ? `the why behind it is on this ticket: ${delta.decisions.length} decision(s) and ${delta.forks.length} fork(s), with what steered each one. Read it with review-context {ticketId} when your person asks why something is the way it is — and review nothing on your own.`
              : `${delta.decisions.length} thought(s) and ${delta.forks.length} fork(s) are on this ticket. Ask your person for THEIR OWN take FIRST — post it with post-review (failed: true asks for changes) — and only then read the author's thoughts with review-context {ticketId}. The blind first take is the point: their view before the author's has coloured it. Never take a position on your own.`,
          ]
            .filter((x) => x.length > 0)
            .join("\n");
        const reviewSteps = reviewers.map((r) => {
          const id = reviewStepId(r.name, r.key, taken);
          taken.set(id, r.key);
          return { id, owner: r.key, intent: takeIntent(kind), description: describe(), needs: [], status: "pending" as const, updatedAt: now };
        });
        // a proposal's work: the steps each recipient is asked to do, waiting on
        // their own ✓ — they owe nothing until they have said yes
        const workSteps = reviewSteps.flatMap((take) =>
          (kind === "proposal" ? (input.work ?? []) : []).map((w) => ({
            id: workStepId(workId(w), take.id.slice("review-".length)),
            owner: take.owner,
            intent: w.intent,
            description: w.description,
            needs: [take.id],
            status: "pending" as const,
            updatedAt: now,
          })),
        );
        {
          const seen = new Set<string>(["address", ...reviewSteps.map((s) => s.id)]);
          for (const w of workSteps) {
            if (seen.has(w.id)) return `failed: work step id "${w.id}" collides with another step on this ticket — give that work item its own 'id'`;
            seen.add(w.id);
          }
        }
        const ticket: Ticket = {
          id: ticketId,
          project: input.project,
          goal,
          createdBy: identity.pubkey,
          kind,
          ...(input.from && input.from.length > 0 ? { from: input.from } : {}),
          ...(input.whenClosed ? { whenClosed: input.whenClosed } : {}),
          structureAt: now,
          updatedAt: now,
          // The author's own step is always there — it waits on everyone asked
          // (on nobody, when nobody was asked) and settling it is how the
          // ticket finishes.
          steps: [
            ...reviewSteps,
            ...workSteps,
            {
              id: "address",
              owner: identity.pubkey,
              intent: "address",
              description:
                asked.length > 0
                  ? `act on ${asked.join(" and ")}'s ${kind === "review" ? "review" : "take"} on ${goal}`
                  : `nobody was asked: this is open to the room. Act on the ${kind === "review" ? "reviews" : "takes"} as they are posted, and settle this step when your user has what they need.`,
              needs: reviewSteps.map((s) => s.id),
              status: "pending" as const,
              updatedAt: now,
            },
          ],
        };
        const review = mergeReview(emptyReview(ticketId, identity.pubkey, myName), {
          ...delta,
          ...(branch ? { branch } : {}),
          ...(link ? { link } : {}),
        }, now);
        return yield* outbox.tell({
          roomId,
          to: asked.length > 0 ? asked.join(", ") : "the room",
          title: `${input.project} · ${kind} · ${goal}`,
          outgoing: { kind: "review", ticket, review },
        });
    });

    return {
      "list-room": () =>
        Effect.gen(function* () {
          const { id, name, room } = yield* focusedRoom;
          const peers = yield* SubscriptionRef.get(room.roster);
          const members = yield* SubscriptionRef.get(room.members);
          const others = (yield* rooms.summaries).filter((r) => r.id !== id);
          // members the log remembers who aren't here right now: you can still
          // message them — they read the log when they are next online
          const offline = members.filter((m) => m.key !== identity.pubkey && !peers.some((p) => p.key === m.key));
          return toToon({
            room: { shortId: shortRoomId(id), name },
            otherRooms: others.map((r) => ({ shortId: r.shortId, name: r.name, online: r.online, unread: r.unread })),
            peers: peers.map((p) => ({
              name: p.name,
              ai: p.ai,
              aiStatus: p.aiStatus,
              away: p.away ?? false,
              projects: p.projects.map((x) => x.name),
              ...(p.protocol === PROTOCOL_VERSION ? {} : { protocol: `${p.protocol} (yours: ${PROTOCOL_VERSION} — one side must update)` }),
            })),
            offlineMembers: offline.map((m) => m.name),
          });
        }).pipe(Effect.withSpan("Mcp.listRoom")),
      "send-to-peer": sendToPeer,
      "pending-threads": () =>
        rooms.current.pipe(
          Effect.flatMap((h) => inbox.pending(h.id)),
          Effect.map((threads) => toToon({ threads })),
          Effect.withSpan("Mcp.pendingThreads"),
        ),
      "watch-room": ({ harness }: { harness: "claude-code" | "codex" | "other" }) =>
        Effect.gen(function* () {
          const url = yield* mcpInfo.awaitUrl;
          const origin = url.replace(/\/mcp$/, "");
          if (harness === "codex") {
            return [
              "You are on codex — collagen can push messages straight into your session:",
              "1. Note your own codex thread id (the thread_id of this conversation).",
              `2. For each collagen thread you care about, call adopt-thread {threadId, agent: "codex", sessionId: <your codex thread id>}.`,
              "3. Done. New messages on adopted threads are queued into your codex session (codex queue) — they appear at your next turn, no blocking, and your user keeps chatting normally. When one appears: tell the user the headline it carries and wait; read the thread only when they ask; never answer it on your own.",
              "For not-yet-adopted threads, check pending-threads when convenient.",
            ].join("\n");
          }
          if (harness === "claude-code") {
            return [
              "You are on Claude Code — arm a persistent background monitor (Monitor tool, or a background bash task). Each output line = one new-message event arriving in this conversation while the user keeps chatting. Script:",
              "",
              "while true; do",
              `  out=$(curl -s -m 70 "${origin}/inbox/wait?seconds=60" || true)`,
              '  [ -n "$out" ] && printf \'%s\\n\' "$out"',
              "  sleep 1",
              "done",
              "",
              "On each event: tell the user the headline in the event line (who, project, intent) and wait. Read the thread with get-messages only when they ask what it says; never answer or act on it yourself.",
              "Optionally also adopt-thread (agent claude-code, your session id) so messages reach you even when this session is closed.",
            ].join("\n");
          }
          return [
            "No push mechanism known for your harness. Options:",
            `- Poll GET ${origin}/inbox/pending (one line per waiting thread) or the pending-threads tool when convenient.`,
            "- await-messages blocks until a message arrives — fine for dedicated watcher loops, not for interactive sessions.",
            "- adopt-thread works if your agent CLI is claude-code or codex.",
          ].join("\n");
        }).pipe(Effect.withSpan("Mcp.watchRoom")),
      "await-messages": ({ seconds }: { seconds?: number }) =>
        Effect.gen(function* () {
          const waitMs = Math.min(Math.max(seconds ?? 55, 5), 570) * 1000;
          const started = yield* Clock.currentTimeMillis;
          while (true) {
            const { id } = yield* focusedRoom;
            const threads = yield* inbox.pending(id);
            if (threads.length > 0) {
              return toToon({
                threads,
                next: "tell your user the headline of each waiting thread (from, project, lastIntent) and wait; read one with get-messages only when they ask; never answer on your own; then call await-messages again",
              });
            }
            const now = yield* Clock.currentTimeMillis;
            if (now - started >= waitMs) {
              return "no new messages — call await-messages again to keep watching the room";
            }
            yield* Effect.sleep("500 millis");
          }
        }).pipe(Effect.withSpan("Mcp.awaitMessages")),
      "adopt-thread": ({ threadId, agent, sessionId }: { threadId: string; agent: "claude-code" | "codex"; sessionId: string }) =>
        Effect.gen(function* () {
          if (!/^[0-9a-f]{16}$/.test(threadId)) return `failed: "${threadId}" is not a collagen thread id — take it from pending-threads or the message you were handed`;
          if (sessionId.trim().length === 0) return "failed: sessionId is empty — pass your harness's session/thread id";
          // `since`: a transcript handed over later starts here, never earlier
          const since = yield* Clock.currentTimeMillis;
          yield* store.update((s) => ({ ...s, threads: { ...(s.threads ?? {}), [threadId]: { ai: agent, sessionId, since } } }));
          yield* Effect.log(`thread ${threadId} adopted → ${agent} ${sessionId.slice(0, 8)}…`);
          return `adopted: new messages on thread ${threadId} will resume your ${agent} conversation (${sessionId})`;
        }).pipe(Effect.withSpan("Mcp.adoptThread")),
      "get-messages": ({ threadId }: { threadId: string }) =>
        rooms.current.pipe(
          Effect.flatMap((h) => inbox.take(h.id, threadId)),
          Effect.map((messages) => toToon({ messages })),
          Effect.withSpan("Mcp.getMessages"),
        ),
      execute: ({ script, input }: { script: string; input?: unknown }) =>
        Effect.promise(() => scripting.execute(script, input)).pipe(
          Effect.map((result) => ({ ...result }) as Record<string, unknown>),
          Effect.withSpan("Mcp.execute"),
        ),
      "search-tools": ({ query }: { query: string }) =>
        Effect.promise(() => scripting.search(query)).pipe(
          Effect.map((matches) => ({ matches })),
          Effect.withSpan("Mcp.searchTools"),
        ),
      "describe-scripting": () =>
        Effect.sync(() => ({ card: scripting.describe() })).pipe(Effect.withSpan("Mcp.describeScripting")),
      "create-ticket": Effect.fn("Mcp.createTicket")(function* (input: {
        goal: string;
        project: string;
        from?: ReadonlyArray<string>;
        whenClosed?: string;
        steps: ReadonlyArray<{
          id?: string;
          owner: string;
          intent: string;
          description: string;
          needs?: ReadonlyArray<string>;
        }>;
      }) {
        const { id: roomId, room } = yield* focusedRoom;
        const peers = yield* SubscriptionRef.get(room.roster);
        const members = yield* SubscriptionRef.get(room.members);
        const myName = yield* SubscriptionRef.get(nameRef);
        // present peers, then anyone the log remembers — an owner may be offline
        const keyFor = (name: string) =>
          name === myName ? identity.pubkey : (peers.find((p) => p.name === name)?.key ?? members.find((m) => m.name === name)?.key);
        const now = yield* Clock.currentTimeMillis;
        const unknown = input.steps.map((s) => s.owner).filter((o) => keyFor(o) === undefined);
        if (unknown.length > 0) {
          return yield* Effect.die(`unknown step owners: ${unknown.join(", ")} — use names from list-room`);
        }
        const id = crypto.randomUUID();
        const ticket: Ticket = {
          id,
          project: input.project,
          goal: input.goal,
          createdBy: identity.pubkey,
          kind: "task",
          ...(input.from && input.from.length > 0 ? { from: input.from } : {}),
          ...(input.whenClosed ? { whenClosed: input.whenClosed } : {}),
          structureAt: now,
          updatedAt: now,
          steps: input.steps.map((s, i) => ({
            id: s.id ?? `s${i + 1}`,
            owner: keyFor(s.owner)!,
            intent: s.intent,
            description: s.description,
            needs: s.needs ?? [],
            status: "pending" as const,
            updatedAt: now,
          })),
        };
        const owners = [...new Set(input.steps.map((s) => s.owner))].join(", ");
        return yield* outbox.tell({ roomId, to: owners, title: `${input.project} · ${input.goal}`, outgoing: { kind: "ticket", ticket } });
      }),
      "ask-review": (input: Parameters<typeof fileJudged>[1]) => fileJudged("review", input),
      "ask-plan": (input: Parameters<typeof fileJudged>[1]) => fileJudged("plan", input),
      propose: (input: Parameters<typeof fileJudged>[1]) => fileJudged("proposal", input),
      "post-review": Effect.fn("Mcp.postReview")(function* (input: { ticketId: string; findings: string; failed?: boolean }) {
        const { id: roomId, room } = yield* focusedRoom;
        const ticket = (yield* SubscriptionRef.get(room.tickets)).get(input.ticketId);
        if (!ticket) return `failed: no ticket ${input.ticketId} — check get-tickets`;
        if (!isJudged(ticket.kind)) {
          return `failed: "${ticket.goal}" is a task, not a review, plan or proposal — settle a step your user owns with settle-step, or weigh in with send-to-peer (pass ticketId)`;
        }
        if (input.findings.trim().length === 0) return "failed: pass what your user actually said about the change";
        const peers = yield* SubscriptionRef.get(room.roster);
        const members = yield* SubscriptionRef.get(room.members);
        const author =
          ticket.createdBy === identity.pubkey
            ? "the room"
            : (peers.find((p) => p.key === ticket.createdBy)?.name ?? members.find((m) => m.key === ticket.createdBy)?.name ?? "the room");
        return yield* outbox.tell({
          roomId,
          to: author,
          title: `${ticket.goal} · your ${ticket.kind === "review" ? "review" : "take"}`,
          outgoing: { kind: "post-review", ticketId: input.ticketId, findings: input.findings, failed: input.failed ?? false },
        });
      }),
      "close-ticket": Effect.fn("Mcp.closeTicket")(function* (input: { ticketId: string; reason?: string }) {
        const { id: roomId, room } = yield* focusedRoom;
        const ticket = (yield* SubscriptionRef.get(room.tickets)).get(input.ticketId);
        if (!ticket) return yield* Effect.die(`no ticket ${input.ticketId} — check get-tickets`);
        return yield* outbox.tell({
          roomId,
          to: "the room",
          title: `${ticket.goal} · closed`,
          outgoing: { kind: "close", ticketId: input.ticketId, ...(input.reason ? { reason: input.reason } : {}) },
        });
      }),
      "settle-step": Effect.fn("Mcp.settleStep")(function* (input: { ticketId: string; stepId: string; result: string; failed?: boolean }) {
        const { id: roomId, room } = yield* focusedRoom;
        const all = yield* SubscriptionRef.get(room.tickets);
        const ticket = all.get(input.ticketId);
        if (!ticket) return yield* Effect.die(`no ticket ${input.ticketId} — check get-tickets`);
        if (!ticket.steps.some((s) => s.id === input.stepId)) {
          return yield* Effect.die(`no step ${input.stepId} on ticket ${input.ticketId}`);
        }
        const peers = yield* SubscriptionRef.get(room.roster);
        const members = yield* SubscriptionRef.get(room.members);
        const creator =
          ticket.createdBy === identity.pubkey
            ? "the room"
            : (peers.find((p) => p.key === ticket.createdBy)?.name ?? members.find((m) => m.key === ticket.createdBy)?.name ?? "the room");
        return yield* outbox.tell({
          roomId,
          to: creator,
          title: `${ticket.goal} · ${input.stepId} ${input.failed ? "failed" : "settled"}`,
          outgoing: { kind: "settle", ticketId: input.ticketId, stepId: input.stepId, result: input.result, failed: input.failed ?? false },
        });
      }),
      "drive-peer": Effect.fn("Mcp.drivePeer")(function* (input: { peer: string; action: DriveAction }) {
        const { room } = yield* focusedRoom;
        const peers = yield* SubscriptionRef.get(room.roster);
        const target = peers.find((p) => p.name === input.peer);
        if (!target) return `failed: no peer named ${input.peer}`;
        if (!(target.ai ?? "").startsWith("mock")) {
          return `failed: ${input.peer} runs "${target.ai ?? "no ai"}", not a mock — real peers can't be driven`;
        }
        return yield* room.sendDrive(target.key, input.action).pipe(
          Effect.map(() => `drive sent — ${input.peer} will ${input.action.kind} as itself`),
          Effect.catchTag("PeerNotConnected", () => Effect.succeed("failed: peer not connected")),
        );
      }),
      // ── settings ──
      "add-project": ({ path, name }: { path: string; name?: string }) =>
        Effect.gen(function* () {
          const { id: roomId, name: roomName } = yield* focusedRoom;
          const abs = resolve(path);
          const isDir = yield* Effect.sync(() => {
            try {
              return statSync(abs).isDirectory();
            } catch {
              return false;
            }
          });
          if (!isDir) return `failed: ${abs} is not an existing directory`;
          const label = (name ?? basename(abs)).trim();
          if (label.length === 0) return "failed: empty project name";
          let outcome = "";
          yield* store.update((s) => {
            const here = s.rooms[roomId] ?? [];
            if (here.some((p) => p.path === abs)) {
              outcome = `already sharing ${abs}`;
              return s;
            }
            if (here.some((p) => p.name === label)) {
              outcome = `failed: a project named "${label}" is already shared in this room — pass a different name`;
              return s;
            }
            outcome = `sharing "${label}" (${abs}) in room ${roomName} — peers see it now`;
            return { ...s, rooms: { ...s.rooms, [roomId]: [...here, newProject(label, abs)] } };
          });
          return outcome;
        }).pipe(Effect.withSpan("Mcp.addProject")),
      "remove-project": ({ name }: { name: string }) =>
        Effect.gen(function* () {
          const { id: roomId } = yield* focusedRoom;
          const before = roomProjects(yield* store.get, roomId);
          if (!before.some((p) => p.name === name)) {
            return `failed: no project named "${name}" in this room (yours: ${before.map((p) => p.name).join(", ") || "none"})`;
          }
          yield* store.update((s) => ({
            ...s,
            rooms: { ...s.rooms, [roomId]: (s.rooms[roomId] ?? []).filter((p) => p.name !== name) },
          }));
          return `stopped sharing "${name}"`;
        }).pipe(Effect.withSpan("Mcp.removeProject")),
      "set-ai": ({ ai }: { ai: string }) =>
        store
          .update((s) => ({ ...s, preferredAi: ai === "none" ? null : ai }))
          .pipe(
            Effect.map(() =>
              ai === "none"
                ? "ai set to none — inbox mode: nothing auto-runs, messages wait to be pulled"
                : `ai set to ${ai} — its auth status is probed now and broadcast to the room`,
            ),
            Effect.withSpan("Mcp.setAi"),
          ),
      "set-name": ({ name }: { name: string }) =>
        Effect.gen(function* () {
          const n = name.trim();
          if (n.length === 0) return "failed: empty name";
          yield* Effect.sync(() => writeProfileFile(profile, { name: n }));
          yield* setName(n);
          return `display name is now "${n}" — peers see it on the next profile broadcast`;
        }).pipe(Effect.withSpan("Mcp.setName")),
      "rename-room": ({ name }: { name: string }) =>
        Effect.gen(function* () {
          const n = name.trim();
          if (n.length === 0) return "failed: empty room name";
          const { room } = yield* focusedRoom;
          return yield* room.rename(n).pipe(
            Effect.map(() => `room renamed to "${n}" for everyone in it`),
            Effect.catchTag("NotWritable", () => Effect.succeed("failed: you are not admitted to this room's log yet — a member has to be online once to admit you")),
          );
        }).pipe(Effect.withSpan("Mcp.renameRoom")),
      "list-rooms": () =>
        Effect.gen(function* () {
          const rows = yield* roomLines;
          const u = yield* SubscriptionRef.get(updates.state);
          // the agent can mention an available update; installing stays the user's key (u)
          const collagen = u.latest ? `${u.current} — update ${u.latest} available (the user presses u in collagen)` : u.current;
          return toToon({ collagen, rooms: rows });
        }).pipe(Effect.withSpan("Mcp.listRooms")),
      "create-room": ({ name }: { name: string }) =>
        Effect.gen(function* () {
          const n = name.trim();
          if (n.length === 0) return "failed: empty room name";
          const entry = newRoomEntry(n);
          yield* rooms.join(entry, true);
          return `created room "${n}" [${shortRoomId(entry.id)}] — you are in it now. Invite id to share: ${entry.id}`;
        }).pipe(Effect.withSpan("Mcp.createRoom")),
      "join-room": ({ inviteId, name }: { inviteId: string; name?: string }) =>
        Effect.gen(function* () {
          const id = inviteId.trim();
          if (!isRoomId(id)) return "failed: that is not a room invite id (expected a uuid)";
          const entry = invitedRoomEntry(id);
          yield* rooms.join(name?.trim() ? { ...entry, name: name.trim() } : entry, true);
          return `joined room [${shortRoomId(id)}] — you are in it now; its shared name arrives from the peers`;
        }).pipe(Effect.withSpan("Mcp.joinRoom")),
      "leave-room": ({ room: which }: { room: string }) =>
        Effect.gen(function* () {
          const q = which.trim();
          const hit = (yield* rooms.summaries).find((r) => r.id === q || r.shortId === q || r.name === q);
          if (!hit) return `failed: no room matching "${q}" — see list-rooms`;
          const outcome = yield* rooms.leave(hit.id);
          return outcome === "left" ? `left "${hit.name}" [${hit.shortId}]` : `failed: ${outcome}`;
        }).pipe(Effect.withSpan("Mcp.leaveRoom")),
      "switch-room": ({ room: which }: { room: string }) =>
        Effect.gen(function* () {
          const q = which.trim();
          const all = yield* rooms.summaries;
          const hit = all.find((r) => r.id === q || r.shortId === q || r.name === q);
          if (!hit) return `failed: no room matching "${q}" — see list-rooms`;
          if (hit.focused) return `already looking at "${hit.name}"`;
          yield* rooms.setFocus(hit.id);
          return `now in "${hit.name}" [${hit.shortId}] — ${hit.online} online, ${hit.unread} unread; all tools now refer to this room`;
        }).pipe(Effect.withSpan("Mcp.switchRoom")),
      "get-tickets": () =>
        focusedRoom.pipe(
          Effect.flatMap(({ room }) => SubscriptionRef.get(room.tickets)),
          Effect.flatMap((m) => Effect.forEach([...m.values()], renderTicket)),
          Effect.map((tickets) => toToon({ tickets })),
          Effect.withSpan("Mcp.getTickets"),
        ),
    };
  });

export const ToolHandlers = CollagenToolkit.toLayer(
  makeHandlers.pipe(Effect.map(({ "drive-peer": _drive, ...handlers }) => handlers)),
);
export const DevToolHandlers = DevCollagenToolkit.toLayer(makeHandlers);

/** The diagnostics registry as tools: one handler per entry, run against the
 *  focused room. Adding a diagnostic touches src/diagnostics only. */
const makeDiagnosticHandlers = Effect.gen(function* () {
  const { identity } = yield* IdentityService;
  const rooms = yield* Rooms;
  const transcripts = yield* Transcripts;
  const attachments = yield* Attachments;
  const handlers: Record<string, (params: unknown) => Effect.Effect<string>> = {};
  for (const d of diagnostics) {
    handlers[d.id] = (params) =>
      rooms.current.pipe(
        Effect.flatMap((h) => d.run(params ?? {}, { roomId: h.id }, { rooms, transcripts, attachments, me: identity.pubkey })),
        Effect.withSpan(`Mcp.${d.id}`),
      );
  }
  return handlers;
});
export const DiagnosticHandlers = DiagnosticToolkit.toLayer(makeDiagnosticHandlers);

/** MCP server over Streamable HTTP on the profile's deterministic port
 *  (ephemeral fallback if taken). Publishes the resolved URL to McpInfo.
 *
 *  v4's protocol adapters own JSON-RPC framing and notification responses,
 *  so the v3-era workarounds (singleton-batch unwrapping, 202-on-empty) are
 *  gone. Newer spec revisions (e.g. stateless 2026-07-28) slot in by adding
 *  their adapter to `protocols` once effect ships it. */
/** Plain-HTTP inbox endpoints beside /mcp, so a watcher script needs no MCP
 *  handshake: GET /inbox/pending lists waiting threads (one line each);
 *  GET /inbox/wait?seconds=N long-polls until something is waiting (204 on
 *  timeout). Read-only — messages are only consumed via get-messages. */
const inboxLine = (t: { threadId: string; from: string; project: string; count: number; lastIntent: string }) =>
  `${t.threadId} | ${t.from} | ${t.project} | ${t.count} msg | ${t.lastIntent}`;

const InboxRoutes = Layer.mergeAll(
  HttpRouter.add(
    "GET",
    "/inbox/pending",
    Effect.gen(function* () {
      const h = yield* (yield* Rooms).current;
      const threads = yield* (yield* Inbox).pending(h.id);
      return HttpServerResponse.text(threads.map(inboxLine).join("\n"));
    }),
  ),
  HttpRouter.add("GET", "/inbox/wait", (request) =>
    Effect.gen(function* () {
      const seconds = Number(new URL(request.url, "http://localhost").searchParams.get("seconds") ?? "60");
      const waitMs = Math.min(Math.max(Number.isFinite(seconds) ? seconds : 60, 1), 300) * 1000;
      const inbox = yield* Inbox;
      const rooms = yield* Rooms;
      const started = yield* Clock.currentTimeMillis;
      while (true) {
        const threads = yield* inbox.pending((yield* rooms.current).id);
        if (threads.length > 0) return HttpServerResponse.text(threads.map(inboxLine).join("\n"));
        const now = yield* Clock.currentTimeMillis;
        if (now - started >= waitMs) return HttpServerResponse.empty({ status: 204 });
        yield* Effect.sleep("500 millis");
      }
    }),
  ),
);

export const McpLive = Layer.unwrap(
  Effect.gen(function* () {
    const { profile } = yield* CliArgs;
    const mcpInfo = yield* McpInfo;

    // Reads the *actual* bound address (matters for the port-0 fallback).
    const announce = Layer.effectDiscard(
      Effect.gen(function* () {
        const server = yield* HttpServer.HttpServer;
        const addr = server.address;
        if (addr._tag === "InetAddressV4" || addr._tag === "InetAddressV6") {
          yield* mcpInfo.set(`http://127.0.0.1:${addr.port}/mcp`);
        }
      }),
    );

    // dev runs (pnpm dev sets COLLAGEN_DEV=1) expose the drive-peer test
    // tool; anything else serves the plain toolkit — the tool doesn't exist.
    const toolkitLayer =
      process.env.COLLAGEN_DEV === "1"
        ? McpServer.toolkit(Toolkit.merge(DevCollagenToolkit, DiagnosticToolkit)).pipe(Layer.provide(Layer.merge(DevToolHandlers, DiagnosticHandlers)))
        : McpServer.toolkit(Toolkit.merge(CollagenToolkit, DiagnosticToolkit)).pipe(Layer.provide(Layer.merge(ToolHandlers, DiagnosticHandlers)));

    const serve = (port: number) =>
      HttpRouter.serve(
        Layer.mergeAll(
          toolkitLayer,
          announce,
          InboxRoutes,
        ).pipe(
          Layer.provideMerge(
            McpServer.layerHttp({
              name: "collagen",
              version: "0.0.0",
              path: "/mcp",
              protocols: [McpProtocol.v2025_11_25, McpProtocol.v2025_06_18, McpProtocol.v2025_03_26],
            }),
          ),
        ),
        { disableListenLog: true },
      ).pipe(Layer.provide(NodeHttpServer.layer(() => createServer(), { port })));

    const port = portForProfile(profile);
    // Say WHY we fell back — a silent ephemeral port makes every registered
    // client point at the wrong place with no trace.
    return serve(port).pipe(
      Layer.catch((e) =>
        Layer.unwrap(
          Effect.logWarning(`mcp port ${port} unavailable (${String(e).slice(0, 120)}) — using an ephemeral port`).pipe(
            Effect.as(serve(0)),
          ),
        ),
      ),
    );
  }),
);
