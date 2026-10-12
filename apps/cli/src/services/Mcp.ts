import { statSync } from "node:fs";
import { createServer } from "node:http";
import { basename, resolve } from "node:path";
import { Clock, Effect, Layer, Schema, SubscriptionRef } from "effect";
import { McpProtocol, McpServer, Tool, Toolkit } from "effect/ai";
import { HttpRouter, HttpServer, HttpServerResponse } from "effect/http";
import { NodeHttpServer } from "@effect/platform-node";
import { encode as toToon } from "@toon-format/toon";
import { NET } from "../app/net";
import { checkInvite } from "../lib/invite";
import { branchLink, hostOf } from "./RepoHost";
import { describeIdentity, gitAuthors, identityOf, ownIdentities } from "./Authorship";
import { afterProblem, AI_OPTIONS, epicForFiling, moveToEpic, claimReview, Confidence, DriveAction, emptyReview, finished, formatInvite, heldBy, ImportanceScore, isJudged, isClosed, isTake, kindsForAgents, mergeReview, newProject, PROTOCOL_VERSION, Remedy, reviewStepId, Room, roomProjects, shortRoomId, takeIntent, ticketName, visibleTo, type Ticket } from "@collagen/p2p";
import { invitedRoomEntry, newRoomEntry, readProfileFile, writeProfileFile } from "../config/profileFile";
import { DiagnosticToolkit, diagnostics } from "../diagnostics";
import { branchOf } from "../lib/gitInfo";
import { noPeerNamed, personNamed, projectSpelling, resolveName, roomRollCall, sameName, type Person } from "../lib/names";
import { assumedGaps, reviewGaps, ticketTitleGap, unitTitleGap, type DecisionInput, type ForkInput } from "../lib/review";
import { ticketView } from "../lib/ticketView";
import { MOCK_AI_OPTIONS } from "./Adapters";
import { portForProfile } from "./mcpAddress";
import { CliArgs } from "./CliArgs";
import { IdentityService } from "./Identity";
import { Inbox } from "./Inbox";
import { sharedProject } from "../lib/projects";
import { Scripting } from "./Scripting";
import { Rooms, type RoomHandle } from "./Rooms";
import { StateStore } from "./StateStore";
import { Outbox } from "./Outbox";
import { ReviewRoutes, unitCoverageNote } from "./ReviewView";
import { acceptDrafts, draftComments, draftsOf, dropDrafts, submitReview } from "./ReviewTalk";
import { ReviewPages } from "./ReviewLive";
import { ReviewServerRoutes } from "./ReviewServer";
import { askWhy } from "./AskWhy";
import { MergeHistory } from "./MergeHistory";
import { Transcripts } from "./Transcripts";
import { Attachments } from "./Attachments";
import { Updates } from "./Updates";
import { McpInfo } from "./McpInfo";
import { STEERING_LABEL, steeringLine, steeringOf } from "../lib/steering";
import { describeSettings, SETTINGS, withSetting } from "../lib/settings";

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
    "Create a shared ticket your user asked for: a structured record of a cross-peer task that every peer in the room holds a merged copy of. Only when your user wants one — never on your own initiative. 'title' is its headline in every list — a few words, 60 characters at most, what it is for; 'goal' is the line beneath it. It reaches the room at once, and the collagen TUI's outbox shows them what went. Steps name an owner (a peer name from list-room, or yourself), an intent verb, a full description, and optional 'needs' (ids of steps that must settle first). When a step becomes actionable (its needs settled), it is delivered to its owner as a message on the thread between you and them about this project; the owner's agent relays it to its person, who decides whether and how it gets done and settles it with settle-step, which unblocks the next steps. Want a review gate? Add a final step you own that needs the work step. 'after' names tickets (ids from get-tickets) this one waits on: until they are answered nobody but your user is shown it or nudged about it. Prefer this over a chain of send-to-peer for multi-step work — the intermediate state stays inspectable by everyone.",
  parameters: Schema.Struct({
    /** the headline the lists show: a few words, 60 characters at most */
    title: Schema.String,
    /** the line beneath it: what the work is, in full */
    goal: Schema.String,
    /** tickets this one follows — a plan it carries out; walked back on request */
    from: Schema.optional(Schema.Array(Schema.String)),
    /** the epic to file it in; left out, the one the tickets it grows out of are in; null for none */
    epic: Schema.optional(Schema.NullOr(Schema.String)),
    /** your user's instruction for the moment they close it, handed back then */
    whenClosed: Schema.optional(Schema.String),
    /** tickets this one waits on: nobody else is shown it until they are answered */
    after: Schema.optional(Schema.Array(Schema.String)),
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
  title: Schema.optional(Schema.String),
  goal: Schema.optional(Schema.String),
  summary: Schema.optional(Schema.String),
  focus: Schema.optional(Schema.String),
  from: Schema.optional(Schema.Array(Schema.String)),
  /** the epic to file it in; left out, the one the tickets it grows out of are in; null for none */
  epic: Schema.optional(Schema.NullOr(Schema.String)),
  after: Schema.optional(Schema.Array(Schema.String)),
  whenClosed: Schema.optional(Schema.String),
  decisions: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.optional(Schema.String),
        title: Schema.String,
        what: Schema.String,
        userWhy: Schema.optional(Schema.String),
        agentWhy: Schema.optional(Schema.String),
        where: Schema.optional(Schema.Array(Schema.String)),
        guidedBy: Schema.optional(Schema.Array(Schema.String)),
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

/** A bug's goal when the agent gave none: the symptom's first sentence, cut
 *  to a line. The symptom itself stays whole on the report. */
const headline = (symptom: string): string => {
  const first = symptom.trim().split(/(?<=[.!?])\s+/)[0] ?? symptom.trim();
  return first.length > 96 ? `${first.slice(0, 93).trimEnd()}…` : first;
};

/** A work item's stable id: the one the agent gave, else its intent. Two items
 *  that would share one is a refusal, not a silent overwrite. */
const workId = (item: { readonly id?: string; readonly intent: string }): string => (item.id ?? item.intent).trim().replace(/\s+/g, "-");
const duplicateWorkId = (work: ReadonlyArray<{ readonly id?: string; readonly intent: string }>): string | null => {
  const seen = new Set<string>();
  for (const item of work) {
    const id = workId(item);
    if (seen.has(id)) return id;
    seen.add(id);
  }
  return null;
};

/** A unit as an agent names it (see ReviewUnit); `usesOf` makes it a group
 *  of repeated uses of another. */
const UnitInput = Schema.Struct({
  id: Schema.optional(Schema.String),
  title: Schema.String,
  what: Schema.String,
  where: Schema.Array(Schema.String),
  usesOf: Schema.optional(Schema.String),
});

export const AssumeReview = Tool.make("assume-review", {
  description: [
    "Build a review of a change from ASSUMPTIONS, when its author did not file one in collagen (a colleague's pull request, say — whether or not they use collagen): no chat of theirs holds the why, so you infer the decisions and forks they made. Only when your user asks you to review such a change (\"review PR 42\", \"go through octocat's pull request\"). For your user's own change, ask-review.",
    "FIRST read everything you can reach, and keep a list of it for 'sources': the pull request — its description, commits, files and comments, through its host's own tool (gh pr view <n> for GitHub) — the issues and tickets it links (a Jira or Linear ticket, through whatever tools you have), its commit messages, and the code — the diff and the code around it.",
    "WHAT AN ASSUMPTION IS: a guess at what the change cannot tell the reader — WHY it was made (the problem the author ran into: a bug, an incident, a review that caught something, a constraint) and WHY THIS WAY (the road they did not take, and what ruled it out). Never a restatement: if the description, a commit message or the code already says it, it is not an assumption — the reader can read it there. \"The skill grows over time\" when the skill says so is noise; \"they wrote it after a leak slipped through review\" is a guess worth checking. Look for the trigger in what surrounds the change: what was fixed or reviewed just before, the issues it links, the code it touches and who last changed it.",
    "YOUR JOB: infer the underlying problem, and why the chosen solution is the one they chose. Not what a function is named or what it is for — why the author wrote it to solve their problem, and what that problem was. One line of code may have six reasons behind it, and then it has six assumptions; a given has none. The count follows the reasons, so it follows the change. No forks unless you can see the other road.",
    "Each decision: 'title' (a few words: the reason or the choice, not the file's own words), 'what' (one line: what you think happened or was chosen), 'why' (your guess at the reason), 'basis' (the evidence for the REASON — the timing, a linked issue, the fix before it — never the line that says what the change is), 'confidence' in the reason (high: someone said why; medium: the evidence points there; low: a hunch from the code), 'where'. 'forks': 'at', 'chose', 'instead', 'why', 'basis', 'confidence'. 'title' and 'summary' of the review: what the change is for. 'units': as for ask-review. Never invent: a guess you cannot ground is not one to file.",
    "WHEN YOUR USER SAYS YOU ARE OFF: amend the same review (ticketId). To edit a guess, give it again with its id ('d2') and the fields as they should be — it is rewritten in place; 'retire' withdraws by id one that should not be there at all (it only restated the change). It stays the same review.",
    "'link' is the pull request: who wrote it ('author'), its 'branch' and 'base' are read from it when you omit them. 'peers' names others in the room to read it too — only who your user named.",
    "It files a review ticket that is your user's to read: a review step of theirs, and the review page shows every assumption marked as a guess, with what it rests on, for them to confirm or put to the author as a question. Amend it with 'ticketId' as you learn more.",
    "WHAT TO TELL YOUR USER: that the review is on the review page, built from your assumptions for them to check — and nothing more; open-review opens it.",
  ].join("\n"),
  parameters: Schema.Struct({
    project: Schema.optional(Schema.String),
    ticketId: Schema.optional(Schema.String),
    title: Schema.optional(Schema.String),
    summary: Schema.optional(Schema.String),
    link: Schema.optional(Schema.String),
    branch: Schema.optional(Schema.String),
    base: Schema.optional(Schema.String),
    author: Schema.optional(Schema.String),
    sources: Schema.optional(Schema.Array(Schema.String)),
    peers: Schema.optional(Schema.Array(Schema.String)),
    decisions: Schema.optional(
      Schema.Array(
        Schema.Struct({
          id: Schema.optional(Schema.String),
          title: Schema.String,
          what: Schema.String,
          why: Schema.String,
          basis: Schema.String,
          confidence: Confidence,
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
          basis: Schema.String,
          confidence: Confidence,
        }),
      ),
    ),
    units: Schema.optional(Schema.Array(UnitInput)),
    retireUnits: Schema.optional(Schema.Array(Schema.String)),
    retire: Schema.optional(Schema.Array(Schema.String)),
  }),
  success: Schema.String,
});

export const ClaimReview = Tool.make("claim-review", {
  description: [
    "Take over a review built from ASSUMPTIONS about your user's own code: someone's AI guessed the decisions and forks behind their pull request (assume-review) before your user was in collagen. Only when your user says it is their code and wants to answer it.",
    "Read the guesses (review-context), then answer each by id ('d1', 'f1' …) FROM WHAT YOU ALREADY KNOW of why your user wrote this code — your conversations with them, their commits, the tickets behind it — as ask-review mines a chat: 'confirmed' — the guess is right; 'corrected' — it is not, and here is the real one ('title' and 'what' for a decision, 'chose' and 'instead' for a fork) with the real reason ('userWhy' in their words where you have them, 'agentWhy' yours); 'wrong' — it is just wrong ('userWhy': why). Ask your user only about a guess that does not settle; argue their side, never invent it.",
    "Add what the guesses missed as you would on ask-review: 'decisions', 'forks', 'units'. Guesses left unanswered stay marked as guesses.",
    "It becomes your user's review — every reader sees each guess answered, the corrected ones beside what was guessed — and theirs to amend from then on with ask-review. Only the code's author can take it over: your user must share an identity with them — signed in to the code's host as its author, or committing in this clone as one of the emails on its commits.",
    "WHAT TO TELL YOUR USER: that the review is theirs now, with their answers on it — nothing more.",
  ].join("\n"),
  parameters: Schema.Struct({
    ticketId: Schema.String,
    answers: Schema.optional(
      Schema.Array(
        Schema.Struct({
          id: Schema.String,
          verdict: Schema.Literals(["confirmed", "corrected", "wrong"]),
          title: Schema.optional(Schema.String),
          what: Schema.optional(Schema.String),
          chose: Schema.optional(Schema.String),
          instead: Schema.optional(Schema.String),
          userWhy: Schema.optional(Schema.String),
          agentWhy: Schema.optional(Schema.String),
        }),
      ),
    ),
    summary: Schema.optional(Schema.String),
    decisions: Schema.optional(
      Schema.Array(
        Schema.Struct({
          id: Schema.optional(Schema.String),
          title: Schema.String,
          what: Schema.String,
          userWhy: Schema.optional(Schema.String),
          agentWhy: Schema.optional(Schema.String),
          where: Schema.optional(Schema.Array(Schema.String)),
          guidedBy: Schema.optional(Schema.Array(Schema.String)),
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
    units: Schema.optional(Schema.Array(UnitInput)),
  }),
  success: Schema.String,
});

/** One rule, said in every tool that files a ticket kind and in the server's instructions:
 *  the kind is the user's to name, never the agent's to swap. */
const KIND_RULE =
  "WHEN YOUR USER NAMES THE KIND (\"as a plan\", \"file it as a proposal\", \"report it as a bug\"), that kind wins: plan is ask-plan, proposal is propose, bug is report-bug, review is ask-review, task is create-ticket. Never substitute a near one, however the work is phrased, and load that tool's schema first if you have not.";

export const AskPlan = Tool.make("ask-plan", {
  description: [
    "File a PLAN: something your user intends to do — work they have already decided on, or want input on first. Asking for input is optional: a plan can sit in the room as the written-down decision, or be put to it for judgment — do you agree, what would you change, what am I missing (\"ask kristian what he thinks of this plan\", \"put this up for input\"). Only when your user asks for a plan (\"make this a plan\", \"open a ticket as a plan\") — never on your own initiative. It reaches the room at once and the outbox shows what went. A question your user could have asked YOU is not a plan; the input asked for is a colleague's, not AI's. It names no owners: steps with owners are a task (create-ticket).",
    KIND_RULE,
    "'title' is the headline every list shows — a few words, 60 characters at most (\"Streamed export\"); required when filing. It names what is to be done, not the reason or the mechanism. 'goal' is the line beneath it — what your user intends (\"stream the export, don't buffer it\"). 'summary' is their thinking in a paragraph. 'decisions' are the thoughts behind it, one per point: a 'title' (a few words, 60 characters at most — the headline a reader sees first: what the point is for, never how), 'what' they mean to do in one line, 'userWhy' in their words, 'agentWhy' what you found, checked or would add — marked as yours. 'forks' are the roads not taken so far, with 'at' as a pointer where there is code, or the area if there is none yet. 'peers' is 0 to many, exactly the names your user said; nobody named means the plan sits in the room for whoever has a take — including your user's own second agent.",
    "Readers give a BLIND FIRST TAKE: their agent hands them the goal alone, they say what they think (post-review; failed: true asks for changes), and only then do your user's thoughts open to them. A ↻ hands the plan back to your user to revise this same ticket (ask-plan with 'ticketId'), never to reply in prose. 'from' names tickets this plan follows (a proposal it answers); 'after' names tickets it WAITS on — phase two after phase one: until they are answered nobody but your user is shown it, and 'after: []' withdraws the order; 'whenClosed' is your user's own instruction for the moment they close it (\"open the Jira tickets\"), handed back to you then.",
    "WHAT TO TELL YOUR USER: that the plan ticket has been filed (or updated), nothing more. KEEP IT CURRENT: when their thinking moves, call ask-plan again with 'ticketId' — re-send the summary if it no longer holds, repeat the id of a changed decision, pass a new 'goal' if the question moved; 'from: []' withdraws the lineage and 'whenClosed: \"\"' the close instruction, leaving either out keeps it. When the takes are in and your user has decided, close-ticket with the conclusion as the reason.",
  ].join("\n"),
  parameters: Schema.Struct(judgedParameters),
  success: Schema.String,
});

export const Propose = Tool.make("propose", {
  description: [
    "File a PROPOSAL: an idea your user wants written down, owed to no one — is it worth doing, what might it involve, who might do it. The cheap kind: alone on their own project they get ideas and want them kept without committing to them, so it goes in with a 'goal' and at least one thought and nothing more is demanded. Only when your user says so (\"file that as a proposal\", \"propose to kristian that…\") — never on your own initiative. Not a plan: a plan is work your user has decided on; a proposal asks first, and nobody owes anything for it.",
    "'peers' is 0 to many, exactly the names your user said — nobody named means the idea sits in the room for whoever has a take, including your user's own second agent, or your user later. A named peer may be asked any of the three questions: is the idea good, would you do it, should I. 'title' is the headline every list shows (a few words, 60 at most; required when filing): the idea in plain words, not how it would be built. 'goal' the line beneath it. 'summary' (optional here), 'decisions' (the why: each with a short 'title' — a few words, the headline — 'what' in one line, 'userWhy' in your user's words, 'agentWhy' yours) and 'forks' as for ask-plan. 'work' is optional and NON-BINDING: an outline of what the work might be — items with an 'id' (stable; defaults to the intent), an intent, a description and, if your user has one in mind, a suggested 'owner' by name. It is kept on the ticket's why for a plan to lift from — no step is ever made from it, named peers included: a peer says in their take whether they would do it. 'from' names tickets this follows; 'whenClosed' is your user's instruction for the moment they close it.",
    KIND_RULE,
    "REVISING (propose with 'ticketId'): 'work' corrects an outline item by id and adds new ids; nothing is ever removed by omission. To withdraw an item, pass 'retireWork' with its ids — an outline is intent, not history, so it goes. 'from: []' withdraws the lineage and 'whenClosed: \"\"' the close instruction; leaving either out leaves it as it was.",
    "Readers give a BLIND FIRST TAKE (see ask-plan). Your user may take their own idea too — post-review on their own proposal is allowed and shows on the row as theirs, so others see it was self-approved and can still add a take. Accepting is judgment, not work: when the idea is accepted the obvious next step is a plan filed with 'from' this ticket (ask-plan), with the outline and suggested owners as prefills — your user confirms that plan, nothing is assigned by accepting. WHAT TO TELL YOUR USER: that the proposal has been filed (or updated), nothing more. KEEP IT CURRENT with propose and 'ticketId'. When your user is done with the idea — a plan grew out of it, or it is dropped — close-ticket with the conclusion as the reason.",
  ].join("\n"),
  parameters: Schema.Struct({
    ...judgedParameters,
    work: Schema.optional(Schema.Array(Schema.Struct({ id: Schema.optional(Schema.String), intent: Schema.String, description: Schema.String, owner: Schema.optional(Schema.String) }))),
    retireWork: Schema.optional(Schema.Array(Schema.String)),
  }),
  success: Schema.String,
});

export const ReportBug = Tool.make("report-bug", {
  description: [
    "File a BUG: a symptom, with your user's reading of it — what is happening, how bad, what could fix it — put to the room for judgment before anyone decides how to go about it. Only when your user says so (\"file that as a bug\", \"report this\") — never on your own initiative. Everyone involved then decides: usually someone opens a Jira ticket, fixes it, and files the fix's review with 'from' this bug, so the reviewers read the report beside the why.",
    KIND_RULE,
    "'symptom' is the one required field: what is wrong, as experienced, in your user's words. 'title' is the headline every list shows — a few words, 60 characters at most; required when filing. It states the problem as someone using the product meets it (\"Export freezes on large files\"), not a code fact (\"export buffers in memory\") and not the fix; a reader must tell what is broken from the title alone. 'goal' is the line beneath it: why it matters, or the fix, goes here; it defaults to the symptom's first sentence. Everything else is the reporter's reading and arrives as it is known: 'cause' {what is actually happening, where: project and file:line}; 'importance' {score 1–5, effect in words} — the scale is anchored: 1 cosmetic (nobody blocked), 2 annoying (a workaround exists), 3 wrong (a feature fails for some), 4 blocking (a feature fails for everyone), 5 breaking (data loss, a security hole, nothing works); 'suggestion' {what could fix it, requirements: loose — a bug carries no formal requirements, a plan lifts these into real ones}; 'remedy' — how big the fix is, the reporter's coarse guess, apart from where the symptom lives: line (a local fix), system (an existing system does the wrong thing), refactor (right in intent, wrong in shape), new (the system that should handle this does not exist). 'decisions' and 'forks' are optional here; 'peers' 0 to many, exactly the names your user said; 'from' and 'whenClosed' as elsewhere.",
    "Readers give a BLIND FIRST TAKE on the symptom alone: their agent hands them the symptom, they say what they make of it (post-review; failed: true asks the reporter for changes), and only then does the reporter's cause, importance, suggestion and remedy open to them — a second, independent diagnosis is the most valuable thing a bug report collects. REVISING (report-bug with 'ticketId'): pass the part of the report that changed — a cause once found, a new score — fields left out keep their value; to withdraw a field that no longer holds (a disproven cause, a score that was wrong) pass 'retire' with its names: cause, importance, suggestion, remedy; 'from: []' and 'whenClosed: \"\"' withdraw those.",
    "WHAT TO TELL YOUR USER: that the bug ticket has been filed (or updated), nothing more. KEEP IT CURRENT with report-bug and 'ticketId'. When the takes are in and your user has decided what happens to it — a plan, a fix and its review, or nothing — close-ticket with the conclusion as the reason.",
  ].join("\n"),
  parameters: Schema.Struct({
    ...judgedParameters,
    symptom: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Struct({ what: Schema.String, where: Schema.optional(Schema.Array(Schema.String)) })),
    importance: Schema.optional(Schema.Struct({ score: ImportanceScore, effect: Schema.String })),
    suggestion: Schema.optional(Schema.Struct({ what: Schema.String, requirements: Schema.optional(Schema.Array(Schema.String)) })),
    remedy: Schema.optional(Remedy),
    retire: Schema.optional(Schema.Array(Schema.Literals(["cause", "importance", "suggestion", "remedy"]))),
  }),
  success: Schema.String,
});

export const AskReview = Tool.make("ask-review", {
  description: [
    "Ask for a review of your user's code, with the WHY attached — the thing a diff cannot show. Only when your user asks for a review (\"ask <peer> for a review\", \"put it up for review\") — never on your own initiative. It reaches the room at once, and the collagen TUI's outbox shows them what went, in full.",
    "'peers' is who is asked, and it is 0 to many — it carries exactly the names your user said, and NONE is the default. They named nobody, you name nobody: never infer a reviewer from who is in the room, who is online, or who touched the code. Name several and each gets a review step of their own. With nobody asked the ticket sits in the room with the why on it for whoever reads it — another peer, or your user's own second agent — and nothing is pushed to anyone. Reviews are posted with post-review, one step per reader, so a second and a third reader can review the same change.",
    "A reviewer must see what the change is FOR before anything else, so lead with purpose. The ticket's 'title' is the review page's headline: a few words a reader gets at a glance (\"Ticket list stays in its box\"). 'summary' is the line beneath it, a sentence or two (200 characters at most): what is different for whoever uses this once it lands — not how it was built, not a list of the parts, and no ticket ids or branch names (the page shows where the code is). Every decision needs a 'title': its headline, a few words (60 characters at most), what it achieves, in plain words — \"Big exports finish\", \"One tab per review\", \"Typos caught before merge\" — never the mechanism (\"SSE endpoint with SubscriptionRef streams\"). 'what' is the line beneath it: what was actually done, in one line. Short and sweet beats complete: the why, the forks and the code carry the rest.",
    "Before calling, read back over THIS conversation and mine it: for each decision behind the change, what your user asked for, prefaced, or ruled out ('userWhy' — their words where you have them) and your own reason for the shape it took ('agentWhy'), plus 'where' it landed (file, or file:line) — required: a rule applied across the change points at every hunk it shaped, and a decision to leave code alone points at that code — and 'guidedBy' when a skill or an agent instruction file told you to do it that way — name each (\"skill: frontend-design\", \"CLAUDE.md\", \"apps/web/AGENTS.md\"); the reader sees it beside the code, so a skill pointing the wrong way is caught there. Leave it out when nothing did. Then the 'units': the change grouped into code that together achieves ONE thing — a component with its sub-components, its implementation and its tests; a service with its routes — each with a 'title' saying what it achieves, never a file name (\"Big exports finish\", not \"export.ts\"; 60 characters at most), a 'what' line beneath it (what that code does, in a line), and 'where' it lives (files, or file:line for one part of a file, as for one route of a big routes file). The review page's sections are units, every piece of code shown once, read building blocks first, each headed by its title, its 'what' and the decisions that shaped it. Cover every change: put a test in the unit of the code it tests; what you leave out goes under the decision pointing at it, else under \"Not explained\", and the outcome names it. Files that only apply one change, each the same way (a new component put to use on ten pages): give that change its unit an 'id', and the files that use it ONE more unit with 'usesOf' set to that id — its 'title' and 'what' say what each use does. The page shows them as one item, marked viewed together, and flags a file that differs from the rest; a file that also does something of its own is not a copy and belongs elsewhere. 'retireUnits' withdraws one by id. Then every fork in the road: a point where you could have gone one way and went the other — 'at' (file:line of the code the choice produced), 'chose', 'instead', 'why', and 'by' (\"user\" if they made the call, \"agent\" if you did). Enough for the reviewer to judge the turn, not an essay. Pass forks as [] only when there genuinely were none. The why is reasons, never a test log: what passed belongs on CI, not on the ticket.",
    "'title' is the ticket's headline in every list — a few words, 60 characters at most, what the change is for; required when filing. The goal beneath it defaults to the branch.",
    "'branch', 'base' and 'link' are read from the project's git when you omit them (a pull request link is better than the branch link collagen can derive). 'focus' is what your user wants looked at.",
    "STACKED REVIEWS: 'after' names the review tickets this one must be read after (ids from get-tickets) — a branch built on another's. Until they are answered (their authors have addressed the reviews, or closed them), nobody but your user is shown this ticket, nudged about it, or can post on it; then it opens like any other. Only when your user says the order matters — when the base is another open review's branch, the outcome points that out and leaves the decision to them. 'after: []' withdraws it.",
    "It creates a review ticket: a step per person asked (their review) and one you own (acting on what comes back). The why goes on the room's log beside it, so it is there when you are offline — and a reader's agent pulls it only when their person asks.",
    "WHAT TO TELL YOUR USER: that the review ticket has been filed (or updated), and nothing more. They asked for it, so do not read the summary, the decisions, the forks or their counts back to them — the ticket carries all of it for whoever reviews it, and their TUI shows the ticket.",
    "KEEP IT CURRENT. A review is not a snapshot: your user will change the code, before or after anyone reads it. Whenever they do, call ask-review again with 'ticketId' — add a decision for what changed and why (their words for it), correct a decision that no longer holds by repeating its id, and pass the new 'branch' or 'link' if the code moved. Everyone reading the ticket is told it was revised, so what they review is what exists. When your user has acted on the feedback, settle your own step with settle-step; if the review was open, settling it closes the invitation.",
  ].join("\n"),
  parameters: Schema.Struct({
    peers: Schema.optional(Schema.Array(Schema.String)),
    project: Schema.optional(Schema.String),
    ticketId: Schema.optional(Schema.String),
    title: Schema.optional(Schema.String),
    goal: Schema.optional(Schema.String),
    summary: Schema.optional(Schema.String),
    focus: Schema.optional(Schema.String),
    branch: Schema.optional(Schema.String),
    base: Schema.optional(Schema.String),
    link: Schema.optional(Schema.String),
    from: Schema.optional(Schema.Array(Schema.String)),
    /** the epic to file it in; left out, the one the tickets it grows out of are in; null for none */
    epic: Schema.optional(Schema.NullOr(Schema.String)),
    after: Schema.optional(Schema.Array(Schema.String)),
    whenClosed: Schema.optional(Schema.String),
    decisions: Schema.optional(
      Schema.Array(
        Schema.Struct({
          id: Schema.optional(Schema.String),
          title: Schema.String,
          what: Schema.String,
          userWhy: Schema.optional(Schema.String),
          agentWhy: Schema.optional(Schema.String),
          where: Schema.optional(Schema.Array(Schema.String)),
          guidedBy: Schema.optional(Schema.Array(Schema.String)),
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
    units: Schema.optional(Schema.Array(UnitInput)),
    retireUnits: Schema.optional(Schema.Array(Schema.String)),
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
    "Close a ticket your user created — only when they say they are done with it, never because you decided it is over. Closing is the author's decision, separate from completion: a ticket whose every step is answered is READY to close (settle-step tells you so), but the person closes it; and they may close one whose reviewer never answered or whose work was abandoned. The ticket leaves the overview and stays on the room's log with its steps exactly as they were, so later tickets can still refer to it; get-tickets keeps showing it with closed: true. Pass 'outcome': 'done' when its work was done (it counts toward its epic's progress, whether or not every step was answered), 'dropped' when it was abandoned, superseded or will not be done (it leaves its epic's progress, as excluded work does) — ask your user when it is not clear which. Pass 'reason' when the close needs explaining (abandoned, superseded, done differently) — it goes on the record. Somebody else's ticket is refused: say what your user thinks with send-to-peer instead.",
  parameters: Schema.Struct({
    ticketId: Schema.String,
    outcome: Schema.Literals(["done", "dropped"]),
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
    "Share a local project folder into the CURRENT room on behalf of the user. 'path' must be an existing directory (absolute, or relative to the agent's cwd); 'name' defaults to the folder name. When that name is a project a peer already shares (however cased), this LOCATES your user's copy of it: it is registered under the room's name for the project, so it stays one project — the outcome says whether it was new to the room or is now shared by one more person. Applies live — peers see it at once and can message about it.",
  parameters: Schema.Struct({ path: Schema.String, name: Schema.optional(Schema.String) }),
  success: Schema.String,
});

export const RemoveProject = Tool.make("remove-project", {
  description: "Stop sharing one of the user's projects in the current room, by name. Applies live.",
  parameters: Schema.Struct({ name: Schema.String }),
  success: Schema.String,
});

export const Epic = Tool.make("epic", {
  description: [
    "Shape the room's EPICS — folders of tickets that together make one body of work (\"more languages\": a proposal for each language, their plans and reviews). Only when your user asks for it; an epic is never your first thought. A ticket filed out of a ticket in an epic goes into that epic as it is filed (pass epic: null when filing to keep it out, or remove it after). Filing outcomes may ask you to OFFER one: which epic, when what it grows out of is in several, or a new epic when your user files several related tickets together — offer in one line, act on their yes.",
    "An epic belongs to the room, not to a project or a person: anyone may put a ticket in, move one from epic to epic, take one out, order them, close an epic or reopen it. A ticket is in one epic at most, and only where it was put — by filing, or by this tool; lineage moves nothing later. Parts may come from any project.",
    "action 'create': title (its headline, a few words), optionally goal (the line beneath it), summary (what it aims for, a sentence or two) and ticketIds to put in it at once. 'add': epicId and ticketIds — moves them in, out of any other epic. 'remove': ticketIds — out of their epic. 'exclude' / 'include': epicId and ticketIds — kept in the epic but out of its progress (work dropped or not to be done there), or counted again. 'order': epicId and ticketIds in the order they are to be read — it hides nothing and sets no after. 'close': epicId — only once everything in it is done, closed or excluded; your user's reason, or by default that its parts are done. 'reopen': epicId and a reason, always. 'rename': epicId and a new title, optionally goal and summary — its author's to do, as a ticket's title is its author's (anyone else asks them).",
    "Progress counts lines of work, not tickets: a proposal, its plan, the task and the review that grew out of each other are one line, done when all of it is — so filing the next stage adds nothing to get through. get-tickets shows each ticket's epic and each epic's parts, progress and what still keeps it open; review-context on an epic reads its aim and its tickets. It goes out as you call it and shows in your user's outbox.",
  ].join("\n"),
  parameters: Schema.Struct({
    action: Schema.Literals(["create", "add", "remove", "exclude", "include", "order", "close", "reopen", "rename"]),
    epicId: Schema.optional(Schema.String),
    title: Schema.optional(Schema.String),
    goal: Schema.optional(Schema.String),
    summary: Schema.optional(Schema.String),
    ticketIds: Schema.optional(Schema.Array(Schema.String)),
    reason: Schema.optional(Schema.String),
  }),
  success: Schema.String,
});

export const SetAi = Tool.make("set-ai", {
  description:
    "Set which agent CLI acts for this user: 'claude-code', 'codex', a mock ('mock:claude-code' / 'mock:codex' — test dummies, visibly labeled to peers), or 'none' (inbox mode: nothing ever auto-runs; messages wait to be pulled). Applies live; peers see the choice and its auth status.",
  parameters: Schema.Struct({ ai: Schema.Literals([...AI_OPTIONS, ...MOCK_AI_OPTIONS, "none"]) }),
  success: Schema.String,
});

export const SetSteering = Tool.make("set-steering", {
  description:
    "Set your user's STEERING — how much you may do on your own with what collagen hands you (a step, a take, a peer's message): 'ask' (tell them what it asks and what you would do, and wait — the default), 'act' (start the work in their repo and tell them as you go), 'auto' (do the work and say when it is done). Only when your user says so — it is their setting, never yours to raise. Whatever the level, anything said in the room for them (a message, a take, a settle, a close) stays their word, and it gates nothing: their harness's own permission mode does that. The level is restated on every delivery you read. Applies live.",
  parameters: Schema.Struct({ steering: Schema.Literals(["ask", "act", "auto"]) }),
  success: Schema.String,
});

export const SetSettings = Tool.make("set-settings", {
  description:
    "Your user's switches, and setting them for them: called with nothing it lists each one, on or off, and what that means; pass one by name to set it. Only when your user says so — they find something in the way, or ask for it back. openReviewPage (on by default): when you start on a review ticket (review-context), collagen opens its page — the diff read by intent — in their browser, once. Applies live, and the settings page in their TUI shows the same switches.",
  parameters: Schema.Struct({ openReviewPage: Schema.optional(Schema.Boolean) }),
  success: Schema.String,
});

export const OpenReview = Tool.make("open-review", {
  description:
    "Open a review ticket's page — the diff grouped under the why, with type hints and peeks — in your user's browser, the same as pressing o on it in the TUI; a page already open there is brought forward instead (on macOS) or replaced by a new tab that keeps their place. When your user asks to see the review, or to read it in the browser. It opens on its own when you start on a review, unless they switched that off (set-settings). Nothing leaves this machine: the page is served by their own collagen, on loopback.",
  parameters: Schema.Struct({ ticketId: Schema.String }),
  success: Schema.String,
});

export const ReviewComments = Tool.make("review-comments", {
  description: [
    "Comments on a review's code, where your user reads it: on the review page, under the lines they are about. When your user asks you to review a change (a review ticket), put each remark that is about particular code here as a DRAFT instead of in the chat — action 'draft' with ticketId and comments [{file, line, startLine?, side?, body}]: the branch's line numbers as the diff shows them, a block of lines from startLine to line (in one hunk), side 'old' only for a removed line. A suggested change is a ```suggestion block in the body holding the lines that should replace those lines. A comment the diff cannot place is refused with why; the rest are kept.",
    "Drafts stay on this machine. Your user reads them beside the code and accepts (into their review, as on GitHub), edits or declines each; their review is said when they finish it — in the room as theirs and, when the review is an open pull request someone else opened, on it as one review with their verdict (through their own gh; on their own pull request it stays in collagen, where it has readers); you call nothing else for that. Say in the chat what you found in a line or two and that the comments are drafts on the review page; do not repeat them there.",
    "On your user's word only: 'accept' (ids, or all when left out) puts drafts into their review; 'submit' finishes the review — every comment pending in it, with 'verdict' ('comment' unless they said approve or request-changes) and 'body' (their words on the whole, optional with comments or an approval). 'Looks good, post them' is accept, then submit. 'decline' (ids, or all): drop drafts. 'list': the drafts, the comments pending in the review, and those said. Your user's take on the ticket itself still goes in post-review.",
  ].join("\n"),
  parameters: Schema.Struct({
    action: Schema.Literals(["draft", "accept", "decline", "submit", "list"]),
    ticketId: Schema.String,
    comments: Schema.optional(
      Schema.Array(
        Schema.Struct({
          file: Schema.String,
          line: Schema.Number,
          startLine: Schema.optional(Schema.Number),
          side: Schema.optional(Schema.Literals(["new", "old"])),
          body: Schema.String,
        }),
      ),
    ),
    ids: Schema.optional(Schema.Array(Schema.String)),
    verdict: Schema.optional(Schema.Literals(["comment", "approve", "request-changes"])),
    body: Schema.optional(Schema.String),
  }),
  success: Schema.String,
});

export const AskWhy = Tool.make("ask-why", {
  description:
    "Why some code is the way it is, from its history: the merges that made it — the one that last changed a line (git blame), the latest that touched a file, or a pull request by number — and, on the review tickets each merge came from, what was decided and why, and the forks taken. Call it before changing or removing code whose reason you do not know, or when your user asks why it was done this way; relay what is there, and say when nothing was recorded. 'file' is a path in the project's clone (absolute, or relative to the project — a worktree's own path reads its copy), 'line' as the file reads now; 'project' when the path does not say it; 'limit' how many merges (3, at most 10). Small on purpose: the decisions and forks about the file first, a few per ticket, the rest counted — review-context {ticketId} reads a ticket's whole why. A decision whose 'standing' is not empty was guessed by an AI, not told by the code's author ('guess'), or answered by them since ('confirmed', 'corrected', 'wrong'). Nothing leaves this machine but reading the merges from the code's host.",
  parameters: Schema.Struct({
    file: Schema.optional(Schema.String),
    line: Schema.optional(Schema.Number),
    pull: Schema.optional(Schema.Number),
    project: Schema.optional(Schema.String),
    limit: Schema.optional(Schema.Number),
  }),
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
    `All shared tickets in the room the user is looking at, merged: goal, steps with owner, status, dependencies and settled results. Read it when your user asks about a ticket or wants the steps behind a headline — relay what is there, never fill gaps from your own head. Returns TOON (compact YAML/CSV-style) text. The kinds, and what each wants of you — ${kindsForAgents()}. Your user sees the same kinds explained in their TUI (? on the overview).`,
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
  AssumeReview,
  ClaimReview,
  AskPlan,
  Propose,
  ReportBug,
  PostReview,
  SettleStep,
  CloseTicket,
  Epic,
  GetTickets,
  AddProject,
  RemoveProject,
  SetAi,
  SetSteering,
  SetSettings,
  OpenReview,
  ReviewComments,
  AskWhy,
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
  AssumeReview,
  ClaimReview,
  AskPlan,
  Propose,
  ReportBug,
  PostReview,
  SettleStep,
  CloseTicket,
  Epic,
  GetTickets,
  AddProject,
  RemoveProject,
  SetAi,
  SetSteering,
  SetSettings,
  OpenReview,
  ReviewComments,
  AskWhy,
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
    const pages = yield* ReviewPages;
    const { profile } = yield* CliArgs;
    const inbox = yield* Inbox;
    const outbox = yield* Outbox;
    const scripting = yield* Scripting;
    const { identity, nameRef, setName } = yield* IdentityService;
    // what the review's comments run on (drafts here, the room's log, who is saying them)
    const talkContext = yield* Effect.context<IdentityService | Rooms | StateStore | MergeHistory>();

    // Every tool is scoped to the room the user is looking at — resolved per
    // call, so switching rooms retargets all of them without a reconnect.
    const focusedRoom = Effect.gen(function* () {
      const handle = yield* rooms.current;
      const meta = yield* SubscriptionRef.get(handle.room.meta);
      return { id: handle.id, name: meta.name, room: handle.room };
    });

    const renderTicket = Effect.fnUntraced(function* (ticket: Ticket) {
      const { room } = yield* focusedRoom;
      const peers = yield* SubscriptionRef.get(room.roster);
      const members = yield* SubscriptionRef.get(room.members);
      const myName = yield* SubscriptionRef.get(nameRef);
      const lookup = (key: string) =>
        key === identity.pubkey
          ? myName
          : (peers.find((peer) => peer.key === key)?.name ?? members.find((member) => member.key === key)?.name ?? key.slice(0, 12));
      const reviews = yield* SubscriptionRef.get(room.reviews);
      const all = yield* SubscriptionRef.get(room.tickets);
      return ticketView(ticket, lookup, reviews.find((review) => review.ticketId === ticket.id), heldBy(ticket, all), all, identity.pubkey);
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
      const who = personNamed(input.peer, { peers, members, me: identity.pubkey });
      if (who._tag === "refused") return who.text;
      // the project as the room spells it, so the thread is the one that exists
      const project = projectSpelling(input.project, peers, roomProjects(yield* store.get, roomId));
      // Outbox → Dispatch: it goes now, and is recorded as having gone
      return yield* outbox.tell({
        roomId,
        to: who.person.name,
        title: `${project} · ${input.intent}`,
        outgoing: {
          kind: "message",
          peer: who.person.name,
          project,
          intent: input.intent,
          findings: input.findings,
          ...(input.ticketId ? { ticketId: input.ticketId } : {}),
        },
      });
    });

    const roomLines = Effect.gen(function* () {
      const all = yield* rooms.summaries;
      const profileFile = readProfileFile(profile);
      return all.map((summary) => ({
        shortId: summary.shortId,
        name: summary.name,
        online: summary.online,
        unread: summary.unread,
        lookingAt: summary.focused,
        inviteId: formatInvite(profileFile.rooms?.find((roomEntry) => roomEntry.id === summary.id)?.id ?? summary.id, NET),
      }));
    });

    /** One filing path for every kind that asks for judgment. A review, a
     *  plan and a proposal share the record (the why, with a tense) and the
     *  mechanics (a take per reader on a step of their own, an address step
     *  the author settles); what differs — code facts read from git, work
     *  steps for a recipient, the words a reader's agent is handed — turns on
     *  `kind` here, in one place, instead of three copies drifting apart. */
    /** A ticket being filed, put into the epic it belongs to (epicForFiling):
     *  the one its filer named, else the one the tickets it grows out of are
     *  in — or `failed: …` for an epic that is not one. */
    const filedInEpic = (ticket: Ticket, room: RoomHandle["room"], chosen: string | null | undefined, now: number) =>
      Effect.map(SubscriptionRef.get(room.tickets), (all: ReadonlyMap<string, Ticket>): Ticket | string => {
        if (typeof chosen === "string" && all.get(chosen)?.kind !== "epic") return `failed: no epic ${chosen} — check get-tickets`;
        const epic = epicForFiling(ticket.from ?? [], all, chosen);
        return epic ? moveToEpic(ticket, epic, identity.pubkey, now) : ticket;
      });

    const fileJudged = Effect.fn("Mcp.fileJudged")(function* (kind: "review" | "plan" | "proposal" | "bug", input: {
        peers?: ReadonlyArray<string>;
        project?: string;
        ticketId?: string;
        title?: string;
        goal?: string;
        summary?: string;
        focus?: string;
        branch?: string;
        base?: string;
        link?: string;
        decisions?: ReadonlyArray<DecisionInput>;
        forks?: ReadonlyArray<ForkInput>;
      
        from?: ReadonlyArray<string>;
        epic?: string | null;
        after?: ReadonlyArray<string>;
        whenClosed?: string;
        work?: ReadonlyArray<{ readonly id?: string; readonly intent: string; readonly description: string; readonly owner?: string }>;
        retireWork?: ReadonlyArray<string>;
        symptom?: string;
        cause?: { readonly what: string; readonly where?: ReadonlyArray<string> };
        importance?: { readonly score: ImportanceScore; readonly effect: string };
        suggestion?: { readonly what: string; readonly requirements?: ReadonlyArray<string> };
        remedy?: Remedy;
        retire?: ReadonlyArray<"cause" | "importance" | "suggestion" | "remedy">;
        units?: ReadonlyArray<{ readonly id?: string; readonly title: string; readonly what: string; readonly where: ReadonlyArray<string>; readonly usesOf?: string }>;
        retireUnits?: ReadonlyArray<string>;
        /** guesses withdrawn by id (assume-review, amending) */
        retireGuesses?: ReadonlyArray<string>;
        /** the why is the filer's AI's assumptions about someone else's change (assume-review) */
        assumed?: { readonly author: string; readonly sources: ReadonlyArray<string>; readonly identities?: ReadonlyArray<string> };
      }) {
        const { id: roomId, room } = yield* focusedRoom;
        const myName = yield* SubscriptionRef.get(nameRef);
        const now = yield* Clock.currentTimeMillis;
        // a proposal's work is an outline on the why, whoever is or is not asked
        const outline =
          kind === "proposal" && input.work && input.work.length > 0
            ? input.work.map((item) => ({ id: workId(item), intent: item.intent, description: item.description, ...(item.owner?.trim() ? { owner: item.owner.trim() } : {}) }))
            : undefined;
        const retireOutline = kind === "proposal" && input.retireWork && input.retireWork.length > 0 ? input.retireWork.map((id) => id.trim().replace(/\s+/g, "-")) : undefined;
        // a bug's report: only the fields given travel, so an amendment that
        // says "the cause is X" leaves the symptom and the score as they were
        const bug =
          kind === "bug"
            ? {
                ...(input.symptom?.trim() ? { symptom: input.symptom.trim() } : {}),
                ...(input.cause ? { cause: { what: input.cause.what, where: input.cause.where ?? [] } } : {}),
                ...(input.importance ? { importance: input.importance } : {}),
                ...(input.suggestion ? { suggestion: { what: input.suggestion.what, requirements: input.suggestion.requirements ?? [] } } : {}),
                ...(input.remedy ? { remedy: input.remedy } : {}),
              }
            : undefined;
        const retireBug = kind === "bug" && input.retire && input.retire.length > 0 ? input.retire : undefined;
        const bugMoves = (bug !== undefined && Object.keys(bug).length > 0) || retireBug !== undefined;
        // a review's units: how its code reads, one thing at a time
        const units = kind === "review" && input.units && input.units.length > 0 ? input.units.map((unit) => ({ ...(unit.id ? { id: unit.id } : {}), title: unit.title.trim(), what: (unit.what ?? "").trim(), where: unit.where.map((location) => location.trim()).filter((location) => location.length > 0), ...(unit.usesOf?.trim() ? { usesOf: unit.usesOf.trim() } : {}) })) : undefined;
        const retireUnits = kind === "review" && input.retireUnits && input.retireUnits.length > 0 ? input.retireUnits : undefined;
        for (const unit of units ?? []) {
          const gap = unitTitleGap(unit.title, unit.what);
          if (gap) return gap;
          if (unit.where.length === 0) return `failed: unit "${unit.title}" points at no code — give its 'where': files, or file:line for one part of a file`;
          if (unit.usesOf !== undefined && unit.usesOf === unit.id) return `failed: unit "${unit.title}" cannot be uses of itself — 'usesOf' is the id of the unit whose change these files apply`;
        }
        const unitsMove = units !== undefined || retireUnits !== undefined;
        const delta = {
          ...(input.summary ? { summary: input.summary } : {}),
          ...(input.base ? { base: input.base } : {}),
          decisions: input.decisions ?? [],
          forks: input.forks ?? [],
          ...(outline ? { outline } : {}),
          ...(retireOutline ? { retireOutline } : {}),
          ...(bug !== undefined && Object.keys(bug).length > 0 ? { bug } : {}),
          ...(retireBug ? { retireBug } : {}),
          ...(units ? { units } : {}),
          ...(retireUnits ? { retireUnits } : {}),
          ...(input.retireGuesses && input.retireGuesses.length > 0 ? { retireGuesses: input.retireGuesses } : {}),
          ...(input.assumed
            ? {
                assumed: {
                  author: input.assumed.author.trim(),
                  sources: input.assumed.sources.map((source) => source.trim()).filter((source) => source.length > 0),
                  ...(input.assumed.identities && input.assumed.identities.length > 0 ? { identities: input.assumed.identities } : {}),
                },
              }
            : {}),
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
          const existing = (yield* SubscriptionRef.get(room.reviews)).find((candidate) => candidate.ticketId === input.ticketId);
          if (existing && existing.author !== identity.pubkey) {
            return `failed: that review's why is ${existing.authorName}'s to write — your user's own reading of the code goes to them with send-to-peer (pass ticketId so it lands on the ticket)`;
          }
          // a why told and a why guessed are never mixed on one review
          const guessed = existing?.assumed !== undefined && existing.claimed === undefined;
          if (existing && guessed !== (input.assumed !== undefined)) {
            return guessed
              ? `failed: that review is built from assumptions — amend it with assume-review, so what you add is marked as a guess too`
              : `failed: that review's why was told, not guessed — amend it with ask-review`;
          }
          // an amendment may move the why, the ticket, or both — but not nothing
          const whyMoves =
            delta.decisions.length > 0 || delta.forks.length > 0 || !!input.summary || !!input.branch || !!input.link || !!input.base || outline !== undefined || retireOutline !== undefined || bugMoves || unitsMove || (input.retireGuesses?.length ?? 0) > 0;
          if (input.title !== undefined) {
            const gap = ticketTitleGap(input.title);
            if (gap) return gap;
          }
          const ticketMoves = input.title !== undefined || input.goal !== undefined || input.from !== undefined || input.after !== undefined || input.whenClosed !== undefined || (input.peers?.length ?? 0) > 0;
          if (!whyMoves && !ticketMoves) return "failed: nothing to amend — pass the decisions, forks or fields you are adding";
          if (whyMoves) {
            const gap = reviewGaps({ ...delta, branch: input.branch, link: input.link }, true, kind);
            if (gap) return gap;
          }
          const review = mergeReview(existing ?? emptyReview(input.ticketId, identity.pubkey, myName), {
            ...delta,
            ...(input.branch ? { branch: input.branch } : {}),
            ...(input.link ? { link: input.link } : {}),
          }, now);
          const present = yield* SubscriptionRef.get(room.roster);
          const known = yield* SubscriptionRef.get(room.members);
          const nameOf = (key: string) => present.find((peer) => peer.key === key)?.name ?? known.find((member) => member.key === key)?.name;

          // "revise the same ticket" has to mean the TICKET too, not only the
          // why behind it: a recipient who asked for changes to a proposal's
          // work is asking for different steps. Takes and settled work are
          // history and stay as they are; what can move is the goal, the
          // lineage, the close instruction, the pending work, and who is asked.
          let revised: Ticket = ticket;
          if (input.goal && input.goal !== ticket.goal) revised = { ...revised, goal: input.goal };
          if (input.title !== undefined && input.title.trim() !== ticket.title) revised = { ...revised, title: input.title.trim() };
          // present means set — and an empty value means withdraw; absent means keep
          if (input.from !== undefined) revised = { ...revised, from: input.from };
          if (input.after !== undefined) {
            const all = yield* SubscriptionRef.get(room.tickets);
            const problem = afterProblem(ticket.id, input.after, all, identity.pubkey);
            if (problem) return `failed: ${problem}`;
            revised = { ...revised, after: [...new Set(input.after)] };
          }
          if (input.whenClosed !== undefined) revised = { ...revised, whenClosed: input.whenClosed };
          const newReaders: Array<Person> = [];
          for (const name of (input.peers ?? []).map((name) => name.trim()).filter((name) => name.length > 0)) {
            const who = personNamed(name, { peers: present, members: known, me: identity.pubkey });
            if (who._tag === "refused") return who.text;
            newReaders.push(who.person);
          }
          const takenNow = new Map(revised.steps.map((step) => [step.id, step.owner]));
          for (const reader of newReaders) {
            if (reader.key === identity.pubkey || revised.steps.some((step) => isTake(step) && step.owner === reader.key)) continue;
            const id = reviewStepId(reader.name, reader.key, takenNow);
            takenNow.set(id, reader.key);
            revised = {
              ...revised,
              steps: [
                ...revised.steps.map((step) => (step.id === "address" ? { ...step, needs: [...step.needs, id], updatedAt: now } : step)),
                { id, owner: reader.key, intent: takeIntent(kind), description: `${reader.name}'s ${kind === "review" ? "review" : "take"} on ${revised.goal}`, needs: [], status: "pending" as const, updatedAt: now },
              ],
            };
          }
          // a proposal's work is its outline, on the why (the delta above): no
          // step is ever made from it — willingness goes in a take, the plan
          // that follows binds whoever it names. Withdrawing is explicit, by id.
          if (kind === "proposal" && input.work && input.work.length > 0) {
            const dup = duplicateWorkId(input.work);
            if (dup) return `failed: two work items would share the id "${dup}" — give each its own 'id' (they default to the intent)`;
          }
          if (kind === "proposal" && retireOutline && retireOutline.length > 0) {
            const missing = retireOutline.filter((id) => !(existing?.outline ?? []).some((item) => item.id === id));
            if (missing.length > 0) return `failed: none of ${missing.join(", ")} is on this proposal's outline — see review-context for what is`;
          }
          const changed = revised !== ticket;
          // the author's clock only ever moves forward, even inside one millisecond
          if (changed) revised = { ...revised, structureAt: Math.max(now, ticket.structureAt + 1), updatedAt: now };

          const owners = [...new Set(revised.steps.map((step) => step.owner).filter((owner) => owner !== identity.pubkey))];
          const named = owners.map(nameOf).filter((name): name is string => name !== undefined);
          const to = named.length > 0 ? named.join(", ") : "the room";
          const told = yield* outbox.tell({
            roomId,
            to,
            title: `${revised.goal} · ${changed ? "revised" : "more why"}`,
            outgoing: { kind: "review", ...(changed ? { ticket: revised } : {}), review },
          });
          const clone = unitsMove && !told.startsWith("failed") ? roomProjects(yield* store.get, roomId).find((candidate) => candidate.name.trim().toLowerCase() === ticket.project.trim().toLowerCase()) : undefined;
          return clone ? told + (yield* unitCoverageNote(clone.path, review)) : told;
        }

        // a new review: who is asked (0 to many), which project, and the why
        if (!input.project) return "failed: pass 'project' (from list-room), and 'peers' if your user has someone in mind — or 'ticketId' to add to a review you already asked for";
        const peers = yield* SubscriptionRef.get(room.roster);
        const members = yield* SubscriptionRef.get(room.members);
        // each name as the room spells it, once however often or however cased it was said
        const reviewers: Array<Person> = [];
        for (const name of (input.peers ?? []).map((name) => name.trim()).filter((name) => name.length > 0)) {
          const who = personNamed(name, { peers, members, me: identity.pubkey });
          if (who._tag === "refused") return `${who.text} (or leave 'peers' out to open the ${kind} to whoever picks it up)`;
          if (!reviewers.some((reviewer) => reviewer.key === who.person.key)) reviewers.push(who.person);
        }
        const asked = reviewers.map((reviewer) => reviewer.name);
        if (input.assumed && reviewers.some((reviewer) => reviewer.key === identity.pubkey)) return "failed: your user reads it anyway — a review built from assumptions is theirs to read; 'peers' names others";
        if (reviewers.some((reviewer) => reviewer.key === identity.pubkey)) {
          return `failed: a ${kind} goes to someone other than your user — leave 'peers' out to open it to whoever picks it up, including their own second agent${kind === "proposal" ? "; their own take goes on it with post-review" : ""}`;
        }
        const dupWork = duplicateWorkId(input.work ?? []);
        if (dupWork) return `failed: two work items would share the id "${dupWork}" — give each its own 'id' (they default to the intent)`;
        if (kind !== "review" && kind !== "bug" && !input.goal) return `failed: pass 'goal' — the line beneath the title: ${kind === "plan" ? "what your user intends to do" : "the idea, as your user would say it"}`;
        const project = resolveName(input.project, [roomProjects(yield* store.get, roomId)]);
        if (project._tag !== "found") {
          const mine = roomProjects(yield* store.get, roomId).map((candidate) => candidate.name).join(", ");
          return `failed: "${input.project}" is not a project your user shares in this room (theirs: ${mine || "none"}) — add-project shares one`;
        }
        const { path: projectPath, name: projectName } = project.value;
        const gap = reviewGaps({ ...delta, branch: input.branch, link: input.link }, false, kind);
        if (gap) return gap;
        // after what the kind itself asks for, so its own refusals come first
        const titleGap = ticketTitleGap(input.title);
        if (titleGap) return titleGap;
        const tickets = yield* SubscriptionRef.get(room.tickets);
        const after = input.after && input.after.length > 0 ? [...new Set(input.after)] : undefined;
        if (after) {
          const problem = afterProblem(undefined, after, tickets, identity.pubkey);
          if (problem) return `failed: ${problem}`;
        }
        // the facts about the code come from the repo when the agent omits them
        // — for a review; a plan or a proposal has no code yet unless the agent says so
        const branch = kind === "review" ? (input.branch ?? branchOf(projectPath) ?? undefined) : input.branch;
        const link = kind === "review" ? (input.link ?? (branch ? (branchLink(projectPath, branch) ?? undefined) : undefined)) : input.link;
        const ticketId = crypto.randomUUID();
        const goal = input.goal ?? (kind === "bug" && bug?.symptom ? headline(bug.symptom) : `review ${branch ?? projectName}`);
        const where = [branch ? `branch ${branch}${input.base ? ` off ${input.base}` : ""}` : "", link ?? ""].filter((part) => part.length > 0).join(" · ");
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
            kind === "review" && input.assumed
              ? `${input.assumed.author}'s change, not filed by them: the why on this ticket is ${myName}'s AI's ASSUMPTIONS — ${delta.decisions.length} decision(s) and ${delta.forks.length} fork(s) inferred from ${input.assumed.sources.join(", ")}, each with what it rests on. Read it with review-context {ticketId} when your person asks — and review nothing on your own.`
              : kind === "review"
              ? `the why behind it is on this ticket: ${delta.decisions.length} decision(s) and ${delta.forks.length} fork(s), with what steered each one. Read it with review-context {ticketId} when your person asks why something is the way it is — and review nothing on your own.`
              : kind === "bug"
                ? `symptom: ${bug?.symptom ?? goal}\nThe reporter's reading of it (cause, importance, suggestion, remedy) is on this ticket. Ask your person for THEIR OWN diagnosis FIRST — what is happening, how bad, what would fix it — and post it with post-review (failed: true asks the reporter for changes); only then read the reporter's reading with review-context {ticketId}. A second independent diagnosis is the point. Never take a position on your own.`
                : `${delta.decisions.length} thought(s) and ${delta.forks.length} fork(s) are on this ticket. Ask your person for THEIR OWN take FIRST — post it with post-review (failed: true asks for changes) — and only then read the author's thoughts with review-context {ticketId}. The blind first take is the point: their view before the author's has coloured it. Never take a position on your own.`,
          ]
            .filter((part) => part.length > 0)
            .join("\n");
        const reviewSteps = reviewers.map((reviewer) => {
          const id = reviewStepId(reviewer.name, reviewer.key, taken);
          taken.set(id, reviewer.key);
          return { id, owner: reviewer.key, intent: takeIntent(kind), description: describe(), needs: [], status: "pending" as const, updatedAt: now };
        });
        // a proposal's work is an outline on its why (the delta), never a step:
        // a peer says whether they would do it in their take, and the plan
        // that grows out of the proposal is what binds anyone
        const ticket: Ticket = {
          id: ticketId,
          project: projectName,
          title: input.title!.trim(),
          goal,
          createdBy: identity.pubkey,
          filedAt: now,
          kind,
          ...(input.from && input.from.length > 0 ? { from: input.from } : {}),
          ...(after ? { after } : {}),
          ...(input.whenClosed ? { whenClosed: input.whenClosed } : {}),
          structureAt: now,
          updatedAt: now,
          // The author's own step is always there — it waits on everyone asked
          // (on nobody, when nobody was asked) and settling it is how the
          // ticket finishes.
          // built from assumptions: the filer reads it — their review step, the
          // author is not in the room to act on what comes back
          steps: input.assumed
            ? [
                ...reviewSteps,
                {
                  id: reviewStepId(myName, identity.pubkey, taken),
                  owner: identity.pubkey,
                  intent: takeIntent(kind),
                  description: `your review of ${input.assumed.author}'s change, built from your AI's assumptions — confirm or challenge each on the review page, then post your review`,
                  needs: [],
                  status: "pending" as const,
                  updatedAt: now,
                },
              ]
            : [
            ...reviewSteps,
            {
              id: "address",
              owner: identity.pubkey,
              intent: "address",
              description:
                asked.length > 0
                  ? `act on ${asked.join(" and ")}'s ${kind === "review" ? "review" : "take"} on ${goal}`
                  : `nobody was asked: this is open to the room. Act on the ${kind === "review" ? "reviews" : "takes"} as they are posted, and settle this step when your user has what they need.`,
              needs: reviewSteps.map((step) => step.id),
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
        // grown out of a part of an epic: filed into it, unless its filer says otherwise
        const inEpic = yield* filedInEpic(ticket, room, input.epic, now);
        if (typeof inEpic === "string") return inEpic;
        const filed = yield* outbox.tell({
          roomId,
          to: asked.length > 0 ? asked.join(", ") : "the room",
          title: `${projectName} · ${kind} · ${goal}`,
          outgoing: { kind: "review", ticket: inEpic, review },
        });
        // a stack the author did not say out loud: noticed, never decided —
        // an inferred order would hide this ticket from its readers as a
        // side effect of naming a base
        const reviews = yield* SubscriptionRef.get(room.reviews);
        const under =
          kind === "review" && !after && input.base
            ? [...tickets.values()].filter(
                (other) => other.kind === "review" && other.id !== ticketId && !isClosed(other) && !finished(other) && visibleTo(other, tickets, identity.pubkey) && reviews.find((candidate) => candidate.ticketId === other.id)?.branch === input.base,
              )
            : [];
        const coverage = units && !filed.startsWith("failed") ? yield* unitCoverageNote(projectPath, review) : "";
        return under.length > 0 && !filed.startsWith("failed")
          ? `${filed}${coverage}\nNOTE FOR YOU, NOT FOR YOUR USER UNLESS IT MATTERS: its base ${input.base} is the branch of the open review "${under[0]!.goal}" [ticket ${under[0]!.id}]. If your user wants this one read after that one, call ask-review with ticketId "${ticketId}" and after ["${under[0]!.id}"] — ask them first; nothing was set.`
          : filed + coverage;
    });

    return {
      "list-room": () =>
        Effect.gen(function* () {
          const { id, name, room } = yield* focusedRoom;
          const peers = yield* SubscriptionRef.get(room.roster);
          const members = yield* SubscriptionRef.get(room.members);
          const others = (yield* rooms.summaries).filter((summary) => summary.id !== id);
          // members the log remembers who aren't here right now: you can still
          // message them — they read the log when they are next online
          const offline = members.filter((member) => member.key !== identity.pubkey && !peers.some((peer) => peer.key === member.key));
          return toToon({
            room: { shortId: shortRoomId(id), name },
            otherRooms: others.map((summary) => ({ shortId: summary.shortId, name: summary.name, online: summary.online, unread: summary.unread })),
            peers: peers.map((peer) => ({
              name: peer.name,
              ai: peer.ai,
              aiStatus: peer.aiStatus,
              away: peer.away ?? false,
              projects: peer.projects.map((project) => project.name),
              ...(peer.protocol === PROTOCOL_VERSION ? {} : { protocol: `${peer.protocol} (yours: ${PROTOCOL_VERSION} — one side must update)` }),
            })),
            offlineMembers: offline.map((member) => member.name),
          });
        }).pipe(Effect.withSpan("Mcp.listRoom")),
      "send-to-peer": sendToPeer,
      "pending-threads": () =>
        rooms.current.pipe(
          Effect.flatMap((handle) => inbox.pending(handle.id)),
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
          yield* store.update((state) => ({ ...state, threads: { ...(state.threads ?? {}), [threadId]: { ai: agent, sessionId, since } } }));
          yield* Effect.log(`thread ${threadId} adopted → ${agent} ${sessionId.slice(0, 8)}…`);
          return `adopted: new messages on thread ${threadId} will resume your ${agent} conversation (${sessionId})`;
        }).pipe(Effect.withSpan("Mcp.adoptThread")),
      "get-messages": ({ threadId }: { threadId: string }) =>
        Effect.gen(function* () {
          const handle = yield* rooms.current;
          const messages = yield* inbox.take(handle.id, threadId);
          // the person's steering rides what the agent is about to act on
          const steering = steeringLine(steeringOf(yield* store.get));
          return toToon(messages.length > 0 ? { steering, messages } : { messages });
        }).pipe(Effect.withSpan("Mcp.getMessages")),
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
        title: string;
        goal: string;
        project: string;
        from?: ReadonlyArray<string>;
        epic?: string | null;
        after?: ReadonlyArray<string>;
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
        // yourself, present peers, then anyone the log remembers — an owner may be offline
        const owners: Array<Person> = [];
        for (const step of input.steps) {
          const who = personNamed(step.owner, { peers, members, me: identity.pubkey, self: { key: identity.pubkey, name: myName } });
          if (who._tag === "refused") return `${who.text} — every step's owner is a person in the room, or your user`;
          owners.push(who.person);
        }
        const now = yield* Clock.currentTimeMillis;
        const project = projectSpelling(input.project, peers, roomProjects(yield* store.get, roomId));
        const after = input.after && input.after.length > 0 ? [...new Set(input.after)] : undefined;
        if (after) {
          const problem = afterProblem(undefined, after, yield* SubscriptionRef.get(room.tickets), identity.pubkey);
          if (problem) return `failed: ${problem}`;
        }
        const titleGap = ticketTitleGap(input.title);
        if (titleGap) return titleGap;
        const id = crypto.randomUUID();
        const ticket: Ticket = {
          id,
          project,
          title: input.title.trim(),
          goal: input.goal,
          createdBy: identity.pubkey,
          filedAt: now,
          kind: "task",
          ...(input.from && input.from.length > 0 ? { from: input.from } : {}),
          ...(after ? { after } : {}),
          ...(input.whenClosed ? { whenClosed: input.whenClosed } : {}),
          structureAt: now,
          updatedAt: now,
          steps: input.steps.map((step, index) => ({
            id: step.id ?? `s${index + 1}`,
            owner: owners[index]!.key,
            intent: step.intent,
            description: step.description,
            needs: step.needs ?? [],
            status: "pending" as const,
            updatedAt: now,
          })),
        };
        const to = [...new Set(owners.map((owner) => owner.name))].join(", ");
        const inEpic = yield* filedInEpic(ticket, room, input.epic, now);
        if (typeof inEpic === "string") return inEpic;
        return yield* outbox.tell({ roomId, to, title: `${project} · ${input.title.trim()}`, outgoing: { kind: "ticket", ticket: inEpic } });
      }),
      "ask-review": (input: Parameters<typeof fileJudged>[1]) => fileJudged("review", input),
      "claim-review": Effect.fn("Mcp.claimReview")(function* (input: {
        ticketId: string;
        answers?: ReadonlyArray<{ readonly id: string; readonly verdict: "confirmed" | "corrected" | "wrong"; readonly title?: string; readonly what?: string; readonly chose?: string; readonly instead?: string; readonly userWhy?: string; readonly agentWhy?: string }>;
        summary?: string;
        decisions?: ReadonlyArray<DecisionInput>;
        forks?: ReadonlyArray<ForkInput>;
        units?: ReadonlyArray<{ readonly id?: string; readonly title: string; readonly what: string; readonly where: ReadonlyArray<string>; readonly usesOf?: string }>;
      }) {
        const { id: roomId, room } = yield* focusedRoom;
        const ticket = (yield* SubscriptionRef.get(room.tickets)).get(input.ticketId);
        if (!ticket) return `failed: no ticket ${input.ticketId} — check get-tickets`;
        const review = (yield* SubscriptionRef.get(room.reviews)).find((candidate) => candidate.ticketId === input.ticketId);
        if (!review?.assumed) return `failed: "${ticketName(ticket)}" was not built from assumptions — there is nothing to take over; your user's own review goes through ask-review`;
        if (review.claimed && review.author !== identity.pubkey) return `failed: ${review.authorName} took this review over already — it is theirs`;
        // only the code's author: someone here shares an identity with them —
        // a login on the code's host, or the email git has on its commits
        const host = review.link ? hostOf(review.link) : undefined;
        // whoever already took it over amends it as theirs; a first takeover proves authorship
        if (!(review.claimed && review.author === identity.pubkey)) {
          const clone = roomProjects(yield* store.get, roomId).find((project) => project.name.trim().toLowerCase() === ticket.project.trim().toLowerCase());
          // who wrote it: as recorded when filed, else read from the code now — the host's
          // author of the pull request, the emails on its commits in this clone
          let theirs = review.assumed.identities ?? (host && review.assumed.author ? [identityOf(host.id, review.assumed.author)] : []);
          if (theirs.length === 0 && clone && review.branch) theirs = yield* gitAuthors(clone.path, review.base ?? "main", review.branch);
          if (theirs.length === 0) {
            return `failed: nobody can tell who wrote this code — ${review.branch ? `the branch ${review.branch} is not in your clone yet (fetch it)` : "the review names no branch"}${host ? "" : " and no host to ask"}. Only its author can take it over, so nobody can until that is known.`;
          }
          const mine = yield* ownIdentities(clone?.path, host);
          if (!mine.some((ownIdentity) => theirs.includes(ownIdentity))) {
            return `failed: this review is about ${review.assumed.author}'s code — written by ${theirs.map(describeIdentity).join(", ")} — and here you are ${mine.length > 0 ? mine.map(describeIdentity).join(", ") : `nobody yet: sign in to ${host?.name ?? "the code's host"}, or set git's user.email in your clone`}. Only its author can take it over.`;
          }
        }
        const answers = input.answers ?? [];
        for (const answer of answers) {
          const decision = review.decisions.find((candidate) => candidate.id === answer.id);
          const fork = review.forks.find((candidate) => candidate.id === answer.id);
          if (!decision && !fork) return `failed: no guess "${answer.id}" on this review — see review-context for their ids`;
          if (answer.verdict === "corrected") {
            if (decision && !answer.what?.trim() && !answer.title?.trim()) return `failed: correcting ${answer.id} needs the real decision — 'title' and 'what'`;
            if (fork && (!answer.chose?.trim() || !answer.instead?.trim())) return `failed: correcting ${answer.id} needs the real turn — 'chose' and 'instead'`;
            if (!answer.userWhy?.trim() && !answer.agentWhy?.trim()) return `failed: correcting ${answer.id} needs the real reason — 'userWhy' in your user's words, or 'agentWhy'`;
          }
        }
        const delta = {
          ...(input.summary ? { summary: input.summary } : {}),
          decisions: input.decisions ?? [],
          forks: input.forks ?? [],
          ...(input.units ? { units: input.units.map((unit) => ({ ...(unit.id ? { id: unit.id } : {}), title: unit.title.trim(), what: unit.what.trim(), where: unit.where, ...(unit.usesOf?.trim() ? { usesOf: unit.usesOf.trim() } : {}) })) } : {}),
        };
        if (answers.length === 0 && delta.decisions.length === 0 && delta.forks.length === 0 && !input.summary && !input.units) return "failed: nothing to take over with — pass your user's answers to the guesses, or their own decisions";
        const gap = reviewGaps(delta, true, "review");
        if (gap && (delta.decisions.length > 0 || delta.forks.length > 0)) return gap;
        const now = yield* Clock.currentTimeMillis;
        const myName = yield* SubscriptionRef.get(nameRef);
        const told = claimReview(review, { key: identity.pubkey, name: myName }, answers, delta, now);
        // theirs to act on now: the reviews of their change
        const takes = ticket.steps.filter((step) => isTake(step)).map((step) => step.id);
        const revised: Ticket = ticket.steps.some((step) => step.id === "address")
          ? ticket
          : { ...ticket, updatedAt: now, steps: [...ticket.steps, { id: "address", owner: identity.pubkey, intent: "address", description: `act on the reviews of your change, ${ticket.goal}`, needs: takes, status: "pending" as const, updatedAt: now }] };
        const sent = yield* outbox.tell({
          roomId,
          to: "the room",
          title: `${ticket.goal} · taken over`,
          outgoing: { kind: "review", ...(revised !== ticket ? { ticket: revised } : {}), review: told },
        });
        if (sent.startsWith("failed")) return sent;
        const count = (verdict: string) => told.decisions.filter((decision) => decision.verdict === verdict).length + told.forks.filter((fork) => fork.verdict === verdict).length;
        const open = told.decisions.filter((decision) => decision.basis !== undefined && decision.verdict === undefined).length + told.forks.filter((fork) => fork.basis !== undefined && fork.verdict === undefined).length;
        return `taken over "${ticketName(ticket)}" [ticket ${ticket.id}] from ${review.authorName}'s AI's guesses: ${count("confirmed")} confirmed, ${count("corrected")} corrected, ${count("wrong")} wrong${open > 0 ? `, ${open} still a guess — answer them with claim-review again` : ""}. It is your user's review now: amend it with ask-review. TELL YOUR USER ONLY THIS: "the review is yours now, with your answers on it".`;
      }),
      "assume-review": Effect.fn("Mcp.assumeReview")(function* (input: {
        project?: string;
        ticketId?: string;
        title?: string;
        summary?: string;
        link?: string;
        branch?: string;
        base?: string;
        author?: string;
        sources?: ReadonlyArray<string>;
        peers?: ReadonlyArray<string>;
        decisions?: ReadonlyArray<{ readonly id?: string; readonly title: string; readonly what: string; readonly why: string; readonly basis: string; readonly confidence: Confidence; readonly where?: ReadonlyArray<string> }>;
        forks?: ReadonlyArray<{ readonly id?: string; readonly at: string; readonly chose: string; readonly instead: string; readonly why: string; readonly basis: string; readonly confidence: Confidence }>;
        units?: ReadonlyArray<{ readonly id?: string; readonly title: string; readonly what: string; readonly where: ReadonlyArray<string>; readonly usesOf?: string }>;
        retireUnits?: ReadonlyArray<string>;
        retire?: ReadonlyArray<string>;
      }) {
        // the pull request, read from its host: who wrote it and where its
        // code is — a fork's branch is on the fork, so its head is read as pr/<n>
        let author = input.author?.trim() || undefined;
        let branch = input.branch;
        let base = input.base;
        const host = input.link ? hostOf(input.link) : undefined;
        if (host && input.link && (!author || !branch || !base)) {
          const got = yield* host.pull(input.link, input.branch);
          if ("pull" in got) {
            author ??= got.pull.author || undefined;
            branch ??= got.pull.fork ? `pr/${got.pull.number}` : got.pull.branch;
            base ??= got.pull.base;
          }
        }
        const { id: roomId, room } = yield* focusedRoom;
        const existing = input.ticketId ? (yield* SubscriptionRef.get(room.reviews)).find((candidate) => candidate.ticketId === input.ticketId) : undefined;
        // who wrote it, as identities no host owns: their login on the host,
        // and the emails git has on the change's commits in this clone
        const projectName = input.project ?? (input.ticketId ? (yield* SubscriptionRef.get(room.tickets)).get(input.ticketId)?.project : undefined);
        const clone = projectName ? roomProjects(yield* store.get, roomId).find((project) => project.name.trim().toLowerCase() === projectName.trim().toLowerCase()) : undefined;
        const fromGit = clone && branch ? yield* gitAuthors(clone.path, base ?? existing?.base ?? "main", branch) : [];
        const identities = [...new Set([...(existing?.assumed?.identities ?? []), ...(host && author ? [identityOf(host.id, author)] : []), ...fromGit])];
        const assumed = {
          author: author ?? existing?.assumed?.author ?? "",
          sources: [...(existing?.assumed?.sources ?? []), ...(input.sources ?? []).filter((source) => !(existing?.assumed?.sources ?? []).includes(source))],
          ...(identities.length > 0 ? { identities } : {}),
        };
        const decisions: ReadonlyArray<DecisionInput> = (input.decisions ?? []).map((decision) => ({ ...(decision.id ? { id: decision.id } : {}), title: decision.title, what: decision.what, agentWhy: decision.why, basis: decision.basis, confidence: decision.confidence, ...(decision.where ? { where: decision.where } : {}) }));
        const forks: ReadonlyArray<ForkInput> = (input.forks ?? []).map((fork) => ({ ...(fork.id ? { id: fork.id } : {}), at: fork.at, chose: fork.chose, instead: fork.instead, why: fork.why, basis: fork.basis, confidence: fork.confidence }));
        const gap = assumedGaps({ decisions, forks, assumed }, input.ticketId !== undefined);
        if (gap) return gap;
        // withdrawing guesses: on a review of yours, guesses still unanswered
        const retire = [...new Set(input.retire ?? [])];
        if (retire.length > 0) {
          if (!existing) return "failed: 'retire' withdraws guesses from a review you filed — pass its ticketId";
          for (const id of retire) {
            const guess = existing.decisions.find((decision) => decision.id === id) ?? existing.forks.find((fork) => fork.id === id);
            if (!guess) return `failed: no guess "${id}" on this review — see review-context for their ids`;
            if (guess.verdict) return `failed: "${id}" was answered by the code's author — it is theirs now`;
          }
        }
        const filed = yield* fileJudged("review", {
          ...(input.project ? { project: input.project } : {}),
          ...(input.ticketId ? { ticketId: input.ticketId } : {}),
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.summary ? { summary: input.summary } : {}),
          ...(input.link ? { link: input.link } : {}),
          ...(branch ? { branch } : {}),
          ...(base ? { base } : {}),
          ...(input.peers ? { peers: input.peers } : {}),
          ...(input.units ? { units: input.units } : {}),
          ...(input.retireUnits ? { retireUnits: input.retireUnits } : {}),
          ...(retire.length > 0 ? { retireGuesses: retire } : {}),
          decisions,
          forks,
          assumed,
        });
        return filed.startsWith("failed") ? filed : `${filed}\nBUILT FROM ASSUMPTIONS about ${assumed.author}'s change: the review page marks each as a guess, with what it rests on, for your user to confirm or put to the author. To add to it or correct it, call assume-review with this ticketId — never ask-review.`;
      }),
      "ask-plan": (input: Parameters<typeof fileJudged>[1]) => fileJudged("plan", input),
      propose: (input: Parameters<typeof fileJudged>[1]) => fileJudged("proposal", input),
      "report-bug": (input: Parameters<typeof fileJudged>[1]) => fileJudged("bug", input),
      "post-review": Effect.fn("Mcp.postReview")(function* (input: { ticketId: string; findings: string; failed?: boolean }) {
        const { id: roomId, room } = yield* focusedRoom;
        const all = yield* SubscriptionRef.get(room.tickets);
        const ticket = all.get(input.ticketId);
        // a ticket still waiting on another is not shown to its readers: to
        // them it is not there yet, and the refusal says no more than that
        if (!ticket || !visibleTo(ticket, all, identity.pubkey)) return `failed: no ticket ${input.ticketId} — check get-tickets`;
        if (!isJudged(ticket.kind)) {
          return `failed: "${ticket.goal}" is a task, not a review, plan or proposal — settle a step your user owns with settle-step, or weigh in with send-to-peer (pass ticketId)`;
        }
        if (input.findings.trim().length === 0) return "failed: pass what your user actually said about the change";
        const peers = yield* SubscriptionRef.get(room.roster);
        const members = yield* SubscriptionRef.get(room.members);
        const author =
          ticket.createdBy === identity.pubkey
            ? "the room"
            : (peers.find((peer) => peer.key === ticket.createdBy)?.name ?? members.find((member) => member.key === ticket.createdBy)?.name ?? "the room");
        return yield* outbox.tell({
          roomId,
          to: author,
          title: `${ticket.goal} · your ${ticket.kind === "review" ? "review" : "take"}`,
          outgoing: { kind: "post-review", ticketId: input.ticketId, findings: input.findings, failed: input.failed ?? false },
        });
      }),
      epic: Effect.fn("Mcp.epic")(function* (input: { action: "create" | "add" | "remove" | "exclude" | "include" | "order" | "close" | "reopen" | "rename"; epicId?: string; title?: string; goal?: string; summary?: string; ticketIds?: ReadonlyArray<string>; reason?: string }) {
        const { id: roomId, room } = yield* focusedRoom;
        const all = yield* SubscriptionRef.get(room.tickets);
        const ids = input.ticketIds ?? [];
        // an epic is named by its title, as the lists name it; `goal` on the
        // record stays what it was filed as
        const move = (epic: { id: string; goal: string; name: string } | null, excluded?: boolean) =>
          outbox.tell({
            roomId,
            to: "the room",
            title: epic ? `${ids.length} ${excluded === true ? "excluded in" : excluded === false ? "counted again in" : "into"} "${epic.name}"` : `${ids.length} out of their epic`,
            outgoing: { kind: "epic-move", ticketIds: [...ids], epic: epic?.id ?? null, goal: epic?.goal ?? "", ...(epic ? { name: epic.name } : {}), ...(excluded !== undefined ? { excluded } : {}) },
          });
        const theEpic = () => {
          const epic = input.epicId ? all.get(input.epicId) : undefined;
          return epic && epic.kind === "epic" ? epic : null;
        };
        const noEpic = `failed: no epic ${input.epicId ?? "(pass epicId)"} — check get-tickets (kind: epic)`;
        switch (input.action) {
          case "create": {
            const titleGap = ticketTitleGap(input.title);
            if (titleGap) return titleGap.replace("the ticket's headline", "the epic's headline");
            const title = input.title!.trim();
            const goal = input.goal?.trim() || title;
            const now = yield* Clock.currentTimeMillis;
            const id = crypto.randomUUID();
            const ticket: Ticket = { id, project: "", title, goal, createdBy: identity.pubkey, filedAt: now, kind: "epic", steps: [], structureAt: now, updatedAt: now };
            const myName = yield* SubscriptionRef.get(nameRef);
            const filed = yield* outbox.tell({
              roomId,
              to: "the room",
              title: `epic · ${title}`,
              outgoing: { kind: "review", ticket, review: mergeReview(emptyReview(id, identity.pubkey, myName), { summary: input.summary?.trim() ?? "" }, now) },
            });
            if (ids.length === 0 || filed.startsWith("failed")) return filed;
            return `${filed} ${yield* move({ id, goal, name: title })}`;
          }
          case "add": {
            const epic = input.epicId ? all.get(input.epicId) : undefined;
            if (!epic || epic.kind !== "epic") return `failed: no epic ${input.epicId ?? "(pass epicId)"} — check get-tickets (kind: epic)`;
            if (ids.length === 0) return "failed: pass the ticketIds to put into it";
            return yield* move({ id: epic.id, goal: epic.goal, name: ticketName(epic) });
          }
          case "remove":
            if (ids.length === 0) return "failed: pass the ticketIds to take out of their epic";
            return yield* move(null);
          case "exclude":
          case "include": {
            const epic = theEpic();
            if (!epic) return noEpic;
            if (ids.length === 0) return `failed: pass the ticketIds to ${input.action} in its progress`;
            return yield* move({ id: epic.id, goal: epic.goal, name: ticketName(epic) }, input.action === "exclude");
          }
          case "order": {
            const epic = theEpic();
            if (!epic) return noEpic;
            if (ids.length === 0) return "failed: pass the ticketIds in the order they are to be read";
            return yield* outbox.tell({ roomId, to: "the room", title: `order of "${ticketName(epic)}"`, outgoing: { kind: "epic-order", epicId: epic.id, goal: epic.goal, name: ticketName(epic), ticketIds: [...ids] } });
          }
          case "close":
          case "reopen": {
            const epic = input.epicId ? all.get(input.epicId) : undefined;
            if (!epic || epic.kind !== "epic") return `failed: no epic ${input.epicId ?? "(pass epicId)"} — check get-tickets (kind: epic)`;
            return yield* outbox.tell({
              roomId,
              to: "the room",
              title: `${ticketName(epic)} · ${input.action === "close" ? "closed" : "reopened"}`,
              outgoing: { kind: "epic-turn", epicId: epic.id, closed: input.action === "close", ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}) },
            });
          }
          case "rename": {
            const epic = theEpic();
            if (!epic) return noEpic;
            // its title follows its author's copy, as every ticket's does
            if (epic.createdBy !== identity.pubkey) return `failed: "${ticketName(epic)}" is its author's to rename — your user can ask them (send-to-peer, with this epicId)`;
            const titleGap = ticketTitleGap(input.title);
            if (titleGap) return titleGap.replace("the ticket's headline", "the epic's headline");
            const title = input.title!.trim();
            const now = yield* Clock.currentTimeMillis;
            // the line beneath goes with it unless a new one is given: a goal that
            // only repeated the old title would now say something else
            const goal = input.goal?.trim() || (epic.goal === epic.title ? title : epic.goal);
            const renamed: Ticket = { ...epic, title, goal, structureAt: Math.max(now, epic.structureAt + 1), updatedAt: now };
            const existing = (yield* SubscriptionRef.get(room.reviews)).find((candidate) => candidate.ticketId === epic.id);
            const myName = yield* SubscriptionRef.get(nameRef);
            const review = mergeReview(existing ?? emptyReview(epic.id, identity.pubkey, myName), input.summary?.trim() ? { summary: input.summary.trim() } : {}, now);
            return yield* outbox.tell({ roomId, to: "the room", title: `epic · ${ticketName(epic)} → ${title}`, outgoing: { kind: "review", ticket: renamed, review } });
          }
        }
      }),
      "close-ticket": Effect.fn("Mcp.closeTicket")(function* (input: { ticketId: string; outcome: "done" | "dropped"; reason?: string }) {
        const { id: roomId, room } = yield* focusedRoom;
        const ticket = (yield* SubscriptionRef.get(room.tickets)).get(input.ticketId);
        if (!ticket) return yield* Effect.die(`no ticket ${input.ticketId} — check get-tickets`);
        return yield* outbox.tell({
          roomId,
          to: "the room",
          title: `${ticket.goal} · closed`,
          outgoing: { kind: "close", ticketId: input.ticketId, outcome: input.outcome, ...(input.reason ? { reason: input.reason } : {}) },
        });
      }),
      "settle-step": Effect.fn("Mcp.settleStep")(function* (input: { ticketId: string; stepId: string; result: string; failed?: boolean }) {
        const { id: roomId, room } = yield* focusedRoom;
        const all = yield* SubscriptionRef.get(room.tickets);
        const ticket = all.get(input.ticketId);
        if (!ticket || !visibleTo(ticket, all, identity.pubkey)) return `failed: no ticket ${input.ticketId} — check get-tickets`;
        if (!ticket.steps.some((step) => step.id === input.stepId)) {
          return yield* Effect.die(`no step ${input.stepId} on ticket ${input.ticketId}`);
        }
        const peers = yield* SubscriptionRef.get(room.roster);
        const members = yield* SubscriptionRef.get(room.members);
        const creator =
          ticket.createdBy === identity.pubkey
            ? "the room"
            : (peers.find((peer) => peer.key === ticket.createdBy)?.name ?? members.find((member) => member.key === ticket.createdBy)?.name ?? "the room");
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
        const found = resolveName(input.peer, [peers], (peer) => peer.key);
        if (found._tag !== "found") return noPeerNamed(input.peer, found, roomRollCall(peers, [], identity.pubkey));
        const target = found.value;
        if (!(target.ai ?? "").startsWith("mock")) {
          return `failed: ${input.peer} runs "${target.ai ?? "no ai"}", not a mock — real peers can't be driven`;
        }
        return yield* room.sendDrive(target.key, input.action).pipe(
          Effect.map(() => `drive sent — ${input.peer} will ${input.action.kind} as itself`),
          Effect.catchTag("PeerNotConnected", () => Effect.succeed("failed: peer not connected")),
        );
      }),
      // ── settings ──
      "add-project": ({ path, name: given }: { path: string; name?: string }) =>
        Effect.gen(function* () {
          const { id: roomId, name: roomName, room } = yield* focusedRoom;
          // a project a peer already shares is LOCATED, not added: the copy is
          // registered under the room's name for it, whatever the folder is
          // called here, so one project stays one row on everyone's panel
          const shared = sharedProject(given ?? basename(resolve(path)), yield* SubscriptionRef.get(room.roster));
          const name = shared?.name ?? given;
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
          yield* store.update((state) => {
            const here = state.rooms[roomId] ?? [];
            if (here.some((project) => project.path === abs)) {
              outcome = `already sharing ${abs}`;
              return state;
            }
            if (here.some((project) => sameName(project.name, label))) {
              outcome = `failed: a project named "${label}" is already shared in this room — pass a different name`;
              return state;
            }
            outcome = `sharing "${label}" (${abs}) in room ${roomName} — peers see it now`;
            return { ...state, rooms: { ...state.rooms, [roomId]: [...here, newProject(label, abs)] } };
          });
          if (!outcome.startsWith("sharing")) return outcome;
          return shared
            ? `${outcome} — you now share "${shared.name}" too, as ${shared.holders.join(" and ")} ${shared.holders.length === 1 ? "does" : "do"}: your copy, located`
            : `${outcome} — a project new to the room`;
        }).pipe(Effect.withSpan("Mcp.addProject")),
      "remove-project": ({ name }: { name: string }) =>
        Effect.gen(function* () {
          const { id: roomId } = yield* focusedRoom;
          const before = roomProjects(yield* store.get, roomId);
          const hit = resolveName(name, [before]);
          if (hit._tag !== "found") {
            return `failed: no project named "${name}" in this room (yours: ${before.map((project) => project.name).join(", ") || "none"})`;
          }
          yield* store.update((state) => ({
            ...state,
            rooms: { ...state.rooms, [roomId]: (state.rooms[roomId] ?? []).filter((project) => project.id !== hit.value.id) },
          }));
          return `stopped sharing "${hit.value.name}"`;
        }).pipe(Effect.withSpan("Mcp.removeProject")),
      "set-ai": ({ ai: agent }: { ai: string }) =>
        store
          .update((state) => ({ ...state, preferredAi: agent === "none" ? null : agent }))
          .pipe(
            Effect.map(() =>
              agent === "none"
                ? "ai set to none — inbox mode: nothing auto-runs, messages wait to be pulled"
                : `ai set to ${agent} — its auth status is probed now and broadcast to the room`,
            ),
            Effect.withSpan("Mcp.setAi"),
          ),
      "set-steering": ({ steering }: { steering: "ask" | "act" | "auto" }) =>
        store.update((state) => ({ ...state, steering })).pipe(
          Effect.map(() => `steering set to ${steering} — ${STEERING_LABEL[steering]}; every delivery now says so. Room-facing actions (messages, takes, settles, closes) remain your user's word.`),
          Effect.withSpan("Mcp.setSteering"),
        ),
      "set-settings": (input: { openReviewPage?: boolean }) =>
        Effect.gen(function* () {
          const changes = SETTINGS.filter((setting) => input[setting.key] !== undefined);
          if (changes.length > 0) yield* store.update((state) => changes.reduce((current, setting) => withSetting(current, setting.key, input[setting.key]!), state));
          const now = describeSettings(yield* store.get);
          return changes.length > 0 ? `set — applies now. Your user's switches:\n${now}` : now;
        }).pipe(Effect.withSpan("Mcp.setSettings")),
      "ask-why": Effect.fn("Mcp.askWhy")(function* (input: { file?: string; line?: number; pull?: number; project?: string; limit?: number }) {
        const { id } = yield* focusedRoom;
        return yield* askWhy(id, input);
      }, Effect.provideContext(talkContext)),
      "open-review": Effect.fn("Mcp.openReview")(function* ({ ticketId }: { ticketId: string }) {
        const { room } = yield* focusedRoom;
        const all = yield* SubscriptionRef.get(room.tickets);
        const ticket = all.get(ticketId);
        if (!ticket || !visibleTo(ticket, all, identity.pubkey)) return `failed: no ticket ${ticketId} — check get-tickets`;
        if (ticket.kind !== "review") return `failed: "${ticket.goal}" is a ${ticket.kind}, not a review — only a review has a page (its why is in review-context)`;
        return yield* pages.show(ticketId);
      }),
      "review-comments": Effect.fn("Mcp.reviewComments")(function* (input: {
        action: "draft" | "accept" | "decline" | "submit" | "list";
        ticketId: string;
        comments?: ReadonlyArray<{ readonly file: string; readonly line: number; readonly startLine?: number; readonly side?: "new" | "old"; readonly body: string }>;
        ids?: ReadonlyArray<string>;
        verdict?: "comment" | "approve" | "request-changes";
        body?: string;
      }) {
        const { room } = yield* focusedRoom;
        const all = yield* SubscriptionRef.get(room.tickets);
        const ticket = all.get(input.ticketId);
        if (!ticket || !visibleTo(ticket, all, identity.pubkey)) return `failed: no ticket ${input.ticketId} — check get-tickets`;
        if (ticket.kind !== "review") return `failed: "${ticket.goal}" is a ${ticket.kind}: comments go on a review's code`;
        const where = (comment: { readonly file: string; readonly line: number; readonly startLine?: number; readonly side: string }) =>
          `${comment.file}:${comment.startLine !== undefined ? `${comment.startLine}-` : ""}${comment.line}${comment.side === "LEFT" ? " (old)" : ""}`;
        if (input.action === "draft") {
          const items = (input.comments ?? []).filter((comment) => Number.isInteger(comment.line) && comment.line > 0 && (comment.startLine === undefined || Number.isInteger(comment.startLine)));
          if (items.length === 0) return "failed: pass 'comments' — each with file, line (a whole number of the branch's code) and body";
          const result = yield* draftComments(input.ticketId, items.map((comment) => ({ file: comment.file, line: comment.line, ...(comment.startLine !== undefined ? { startLine: comment.startLine } : {}), side: comment.side === "old" ? ("LEFT" as const) : ("RIGHT" as const), body: comment.body })));
          if ("error" in result) return `failed: ${result.error}`;
          if (result.drafted.length > 0) yield* pages.started(input.ticketId);
          const refused = result.refused.length > 0 ? `\nREFUSED (not drafted — fix and draft them again):\n${result.refused.map((refusal) => `- ${refusal.at}: ${refusal.why}`).join("\n")}` : "";
          if (result.drafted.length === 0) return `failed: no comment could be placed on the diff.${refused}`;
          return `${result.drafted.length} draft comment(s) on the review page, under the lines they are about: ${result.drafted.map((draft) => `${draft.id} ${where(draft)}`).join(", ")}.${refused}\nTELL YOUR USER, in a line or two: what you found, and that your comments are drafts on the review page beside the code — they accept, edit or decline each there and finish their review, or tell you to post them. Do not repeat the comments in the chat.`;
        }
        const ids = input.ids && input.ids.length > 0 ? input.ids : null;
        const failures = (failed: ReadonlyArray<{ readonly id: string; readonly error: string }>) => (failed.length > 0 ? `\nNOT DONE:\n${failed.map((failure) => `- ${failure.id}: ${failure.error}`).join("\n")}` : "");
        if (input.action === "accept") {
          const result = yield* acceptDrafts(input.ticketId, ids);
          if (result.done === 0 && result.failed.length === 0) return "nothing to accept: no drafts are waiting on this review";
          const pending = (yield* draftsOf(input.ticketId)).filter((draft) => draft.status === "pending").length;
          return `${result.done} draft(s) put into your user's review — ${pending} comment(s) pending in it, said when the review is finished (submit).${failures(result.failed)}`;
        }
        if (input.action === "submit") {
          const result = yield* submitReview(input.ticketId, input.verdict ?? "comment", input.body ?? "", null, null);
          if ("error" in result) return `failed: ${result.error} — the review stays pending`;
          return `review finished: ${result.said} comment(s) said in the room as your user's${result.roomOnly ? ` — not on the pull request: ${result.roomOnly}` : `, and the review is on the pull request${"url" in result && result.url ? `: ${result.url}` : ""}`}.`;
        }
        if (input.action === "decline") {
          const dropped = yield* dropDrafts(input.ticketId, ids, "ai");
          return dropped === 0 ? "nothing declined: no such drafts waiting" : `${dropped} draft(s) declined — said nowhere`;
        }
        const mine = yield* draftsOf(input.ticketId);
        const said = (yield* SubscriptionRef.get(room.comments)).filter((comment) => comment.ticketId === input.ticketId);
        return toToon({
          drafts: mine.filter((draft) => draft.status !== "pending").map((draft) => ({ id: draft.id, at: where(draft), body: draft.body })),
          pending: mine.filter((draft) => draft.status === "pending").map((draft) => ({ id: draft.id, at: where(draft), body: draft.body })),
          said: said.map((comment) => ({ by: comment.authorName, at: where(comment), body: comment.body, ...(comment.host ? { onHost: comment.host.url } : {}), ...(comment.drafted ? { drafted: true } : {}) })),
        });
      }, Effect.provideContext(talkContext)),
      "set-name": ({ name }: { name: string }) =>
        Effect.gen(function* () {
          const displayName = name.trim();
          if (displayName.length === 0) return "failed: empty name";
          yield* Effect.sync(() => writeProfileFile(profile, { name: displayName }));
          yield* setName(displayName);
          return `display name is now "${displayName}" — peers see it on the next profile broadcast`;
        }).pipe(Effect.withSpan("Mcp.setName")),
      "rename-room": ({ name }: { name: string }) =>
        Effect.gen(function* () {
          const roomName = name.trim();
          if (roomName.length === 0) return "failed: empty room name";
          const { room } = yield* focusedRoom;
          return yield* room.rename(roomName).pipe(
            Effect.map(() => `room renamed to "${roomName}" for everyone in it`),
            Effect.catchTag("NotWritable", () => Effect.succeed("failed: you are not admitted to this room's log yet — a member has to be online once to admit you")),
          );
        }).pipe(Effect.withSpan("Mcp.renameRoom")),
      "list-rooms": () =>
        Effect.gen(function* () {
          const rows = yield* roomLines;
          const version = yield* SubscriptionRef.get(updates.state);
          // the agent can mention an available update; installing stays the user's key (u)
          const collagen = version.latest ? `${version.current} — update ${version.latest} available (the user presses u in collagen)` : version.current;
          return toToon({ collagen, rooms: rows });
        }).pipe(Effect.withSpan("Mcp.listRooms")),
      "create-room": ({ name }: { name: string }) =>
        Effect.gen(function* () {
          const roomName = name.trim();
          if (roomName.length === 0) return "failed: empty room name";
          const entry = newRoomEntry(roomName);
          yield* rooms.join(entry, true);
          return `created room "${roomName}" [${shortRoomId(entry.id)}] — you are in it now. Invite id to share: ${formatInvite(entry.id, NET)}`;
        }).pipe(Effect.withSpan("Mcp.createRoom")),
      "join-room": ({ inviteId, name }: { inviteId: string; name?: string }) =>
        Effect.gen(function* () {
          const check = checkInvite(inviteId);
          if (!check.ok) return `failed: ${check.reason}`;
          const id = check.id;
          const entry = invitedRoomEntry(id);
          yield* rooms.join(name?.trim() ? { ...entry, name: name.trim() } : entry, true);
          return `joined room [${shortRoomId(id)}] — you are in it now; its shared name arrives from the peers`;
        }).pipe(Effect.withSpan("Mcp.joinRoom")),
      "leave-room": ({ room: which }: { room: string }) =>
        Effect.gen(function* () {
          const query = which.trim();
          const hit = (yield* rooms.summaries).find((summary) => summary.id === query || summary.shortId === query || sameName(summary.name, query));
          if (!hit) return `failed: no room matching "${query}" — see list-rooms`;
          const outcome = yield* rooms.leave(hit.id);
          return outcome === "left" ? `left "${hit.name}" [${hit.shortId}]` : `failed: ${outcome}`;
        }).pipe(Effect.withSpan("Mcp.leaveRoom")),
      "switch-room": ({ room: which }: { room: string }) =>
        Effect.gen(function* () {
          const query = which.trim();
          const all = yield* rooms.summaries;
          const hit = all.find((summary) => summary.id === query || summary.shortId === query || sameName(summary.name, query));
          if (!hit) return `failed: no room matching "${query}" — see list-rooms`;
          if (hit.focused) return `already looking at "${hit.name}"`;
          yield* rooms.setFocus(hit.id);
          return `now in "${hit.name}" [${hit.shortId}] — ${hit.online} online, ${hit.unread} unread; all tools now refer to this room`;
        }).pipe(Effect.withSpan("Mcp.switchRoom")),
      "get-tickets": () =>
        focusedRoom.pipe(
          Effect.flatMap(({ room }) => SubscriptionRef.get(room.tickets)),
          // a ticket waiting on another is its author's alone until it opens
          Effect.flatMap((tickets) => Effect.forEach([...tickets.values()].filter((ticket) => visibleTo(ticket, tickets, identity.pubkey)), renderTicket)),
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
  const pages = yield* ReviewPages;
  const handlers: Record<string, (params: unknown) => Effect.Effect<string>> = {};
  for (const diagnostic of diagnostics) {
    handlers[diagnostic.id] = (params) =>
      rooms.current.pipe(
        Effect.flatMap((handle) => diagnostic.run(params ?? {}, { roomId: handle.id }, { rooms, transcripts, attachments, me: identity.pubkey, reviewStarted: pages.started })),
        Effect.withSpan(`Mcp.${diagnostic.id}`),
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
const inboxLine = (thread: { threadId: string; from: string; project: string; count: number; lastIntent: string }) =>
  `${thread.threadId} | ${thread.from} | ${thread.project} | ${thread.count} msg | ${thread.lastIntent}`;

const InboxRoutes = Layer.mergeAll(
  HttpRouter.add(
    "GET",
    "/inbox/pending",
    Effect.gen(function* () {
      const handle = yield* (yield* Rooms).current;
      const threads = yield* (yield* Inbox).pending(handle.id);
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

    // Loopback only: the tools act for this person — send, settle, attach
    // their files, hand over their transcripts — and are for agents on this
    // machine. Node's default would listen on every interface.
    const serve = (port: number) =>
      HttpRouter.serve(
        Layer.mergeAll(
          toolkitLayer,
          announce,
          InboxRoutes,
          ReviewRoutes,
          ReviewServerRoutes,
        ).pipe(
          Layer.provideMerge(
            McpServer.layerHttp({
              name: "collagen",
              version: "0.0.0",
              instructions: KIND_RULE,
              path: "/mcp",
              protocols: [McpProtocol.v2025_11_25, McpProtocol.v2025_06_18, McpProtocol.v2025_03_26],
            }),
          ),
        ),
        { disableListenLog: true },
      ).pipe(Layer.provide(NodeHttpServer.layer(() => createServer(), { port, host: "127.0.0.1" })));

    const port = portForProfile(profile);
    // Say WHY we fell back — a silent ephemeral port makes every registered
    // client point at the wrong place with no trace.
    return serve(port).pipe(
      Layer.catch((error) =>
        Layer.unwrap(
          Effect.logWarning(`mcp port ${port} unavailable (${String(error).slice(0, 120)}) — using an ephemeral port`).pipe(
            Effect.as(serve(0)),
          ),
        ),
      ),
    );
  }),
);
