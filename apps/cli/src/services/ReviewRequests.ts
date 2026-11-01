import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Clock, Context, Duration, Effect, Layer, Stream, SubscriptionRef } from "effect";
import { encode as toToon } from "@toon-format/toon";
import { conversationKey, roomProjects, type AskedReview, type Conversation, type ReviewAskHeld, type ReviewAskStage, type RoomMessage } from "@collagen/p2p";
import { firstRef, run } from "../lib/gitRun";
import { defaultBranchOf } from "../lib/gitInfo";
import { filingPrompt, readable, workConversations, type Found } from "../lib/reviewRequests";
import { nextAsk, type AskEvent } from "../lib/askMachine";
import { allow, levelOf } from "../lib/steering";
import { readLine } from "../lib/transcripts";
import { sameName } from "../lib/names";
import { AgentRunner } from "./AgentRunner";
import { CliArgs } from "./CliArgs";
import { harnessFor, Harnesses, homesOf, transcriptFile } from "./Harness";
import { configDir, IdentityService } from "./Identity";
import { Inbox } from "./Inbox";
import { Jobs } from "./Jobs";
import { mcpServerName } from "./mcpAddress";
import { Outbox } from "./Outbox";
import { hostOf } from "./RepoHost";
import { Rooms, type RoomHandle } from "./Rooms";
import { StateStore } from "./StateStore";

// A review asked of someone's work that has no review ticket yet
// (request-review). Both ends live here.
//
// The author's end: the ask arrives on the room's log, and their steering for
// review asks (others') decides — not chosen or never, it waits on them; ask
// first, their agent asks them; act or just do it, collagen finds the
// conversation the work was done in, from the harnesses' own records, and
// queues a filing job that reads a copy of it and files the review ticket
// with ask-review, in the author's name. Each stage goes back to the asker
// on the thread between them, and the ask is kept until it is filed or
// declined, so an offline spell or a restart loses nothing.
//
// The asker's end: each stage reaches the conversation that asked, as their
// delivery steering allows; once the ticket is filed, a review the asker
// already wrote goes on it as their take. Without one, their review step on
// it arrives like any other (actionableSteps).

/** How far back a conversation is looked for when the branch's own history does not say. */
const LOOK_BACK = Duration.toMillis(Duration.days(30));
/** How long a filed ticket is waited for before a sent review is put on it. */
const TICKET_WAIT = Duration.minutes(10);

/** What the asker reads of each stage, in the author's name. */
const stageText = (stage: ReviewAskStage, author: string, extra = ""): string => {
  switch (stage) {
    case "waiting":
      return `Waits on ${author}${extra ? `: ${extra}` : "."}`;
    case "asking":
      return `${author} is asked whether to file it.`;
    case "filing":
      return `${author}'s AI is reading the conversation the work was done in, and files the review ticket.`;
    case "filed":
      return `${author} filed the review ticket${extra ? `: ${extra}` : "."}`;
    case "declined":
      return `${author} declined${extra ? `: ${extra}` : "."}`;
    case "unsure":
      return `${author} is asked which conversation holds the work.`;
  }
};

/** What the person asks for (request-review). */
export interface AskInput {
  readonly peer: { readonly key: string; readonly name: string };
  readonly project: string;
  readonly branch?: string;
  readonly link?: string;
  readonly note?: string;
  readonly review?: AskedReview["review"];
}

/** What the author says to an ask (review-request). */
export interface Answer {
  readonly requestId?: string;
  readonly file?: boolean;
  readonly conversations?: ReadonlyArray<string>;
  readonly decline?: string;
  readonly unsure?: string;
}

export class ReviewRequests extends Context.Service<ReviewRequests>()("cli/ReviewRequests", {
  make: Effect.gen(function* () {
    const rooms = yield* Rooms;
    const store = yield* StateStore;
    const harnesses = yield* Harnesses;
    const jobs = yield* Jobs;
    const inbox = yield* Inbox;
    const outbox = yield* Outbox;
    const runner = yield* AgentRunner;
    const { profile } = yield* CliArgs;
    const { identity, nameRef } = yield* IdentityService;
    const server = mcpServerName(profile);
    const copies = join(configDir, `review-asks-${profile}`);

    const handleOf = (roomId: string) => SubscriptionRef.get(rooms.handles).pipe(Effect.map((all) => all.find((handle) => handle.id === roomId)));
    const heldOf = (roomId: string, id: string) => store.get.pipe(Effect.map((state) => (state.reviewAsks ?? []).find((held) => held.roomId === roomId && held.id === id)));
    const keep = (held: ReviewAskHeld) =>
      store.update((state) => ({ ...state, reviewAsks: [...(state.reviewAsks ?? []).filter((had) => !(had.roomId === held.roomId && had.id === held.id)), held] }));
    /** An ask moved by an event, as the machine's table says (lib/askMachine) — or refused, when its
     *  state has no such move: it never lands somewhere the table does not say. */
    const move = (held: ReviewAskHeld, on: AskEvent, also: Partial<ReviewAskHeld> = {}) =>
      Effect.gen(function* () {
        const to = nextAsk(held.stage, on);
        if (to === null) {
          yield* Effect.logWarning(`review ask ${held.id.slice(0, 8)}: "${on}" has no move from ${held.stage} — refused`);
          return null;
        }
        const moved: ReviewAskHeld = { ...held, ...also, stage: to };
        yield* keep(moved);
        return moved;
      });

    /** Tell the asker how far their ask has come: collagen's own record of
     *  it on the thread between them, not words said for the author. */
    const tellAsker = (held: ReviewAskHeld, stage: ReviewAskStage, extra = "", ticketId?: string) =>
      Effect.gen(function* () {
        const handle = yield* handleOf(held.roomId);
        if (!handle) return yield* Effect.logWarning(`review ask ${held.id.slice(0, 8)}: its room is gone, so ${held.fromName} is not told it is ${stage}`);
        const author = yield* SubscriptionRef.get(nameRef);
        yield* Effect.log(`review ask ${held.id.slice(0, 8)} → ${held.fromName}: ${stage}`);
        yield* handle.room
          .sendTo(held.from, { project: held.project, intent: `review-request:${stage}`, findings: stageText(stage, author, extra), reviewStatus: { id: held.id, stage, ...(ticketId ? { ticketId } : {}) } })
          .pipe(Effect.catchTag("NotWritable", () => Effect.logWarning("cannot tell the asker how their review ask stands: not admitted to the room log")));
      });

    /** Put a line for the person's agent on the ask's thread, and wake the
     *  conversation that holds it, as their delivery steering allows. */
    const tellHere = (held: ReviewAskHeld, intent: string, findings: string) =>
      Effect.gen(function* () {
        const message: RoomMessage = { id: crypto.randomUUID(), threadId: held.threadId, from: held.from, fromName: held.fromName, to: identity.pubkey, project: held.project, intent, findings, ts: yield* Clock.currentTimeMillis };
        yield* inbox.push(held.roomId, message);
        yield* Effect.forkChild(runner.runThread(held.threadId));
      });

    // --- finding the work ---------------------------------------------------

    /** The project's folder and its worktrees. */
    const rootsOf = (path: string) =>
      run("git", ["worktree", "list", "--porcelain"], path, 10_000).pipe(
        Effect.map((out) => [path, ...(out ?? "").split("\n").flatMap((line) => (line.startsWith("worktree ") ? [line.slice("worktree ".length).trim()] : []))]),
      );

    /** The branch a pull request is, when only its link was given. */
    const branchOfAsk = (held: ReviewAskHeld) =>
      Effect.gen(function* () {
        if (held.branch) return held.branch;
        const host = held.link ? hostOf(held.link) : undefined;
        if (!host || !held.link) return undefined;
        const found = yield* host.pull(held.link, undefined);
        return "pull" in found ? found.pull.branch : undefined;
      });

    /** The branch's own commits against where its code lands: their files and when it began. */
    const changeOf = (path: string, branch: string) =>
      Effect.gen(function* () {
        const head = yield* firstRef(path, [branch, `origin/${branch}`]);
        if (!head) return null;
        const landsOn = defaultBranchOf(path);
        const base = landsOn ? yield* firstRef(path, [`origin/${landsOn}`, landsOn]) : null;
        const range = base ? `${base}...${head}` : head;
        const files = ((yield* run("git", ["diff", "--name-only", range], path, 30_000)) ?? "").split("\n").map((file) => file.trim()).filter((file) => file.length > 0);
        const first = Number(((yield* run("git", ["log", "--reverse", "--format=%ct", base ? `${base}..${head}` : head, "-n", "1000"], path, 30_000)) ?? "").split("\n")[0]) * 1000;
        const diff = base ? yield* run("git", ["diff", range], path, 30_000) : null;
        return { head, files, began: Number.isFinite(first) && first > 0 ? first : null, diff };
      });

    /** The person's conversations that did the work on `branch` in the project at `path`. */
    /** The person's conversations that did the work on `branch` in the
     *  project at `path`: never one of collagen's own jobs, nor a review
     *  page's chat (a session in the clone, talking of the same branch), nor
     *  any in `skip` (a review's readers, say). */
    const findWork = (path: string, branch: string, skipToo: ReadonlySet<string> = new Set()) =>
      Effect.gen(function* () {
        const roots = yield* rootsOf(path);
        const change = yield* changeOf(path, branch);
        const now = yield* Clock.currentTimeMillis;
        const since = (change?.began ?? now - LOOK_BACK) - Duration.toMillis(Duration.days(1));
        const homes = homesOf(harnesses);
        const state = yield* store.get;
        const skip = new Set([...(state.jobConversations ?? []), ...Object.values(state.chats ?? {}).map((chat) => `${chat.ai}:${chat.id}`), ...skipToo]);
        const found = yield* Effect.promise(async () => {
          const out: Array<Found> = [];
          for (const harness of harnesses) {
            const home = homes[harness.id];
            if (!home) continue;
            for (const file of await harness.usage.sessions(home, since).catch(() => [])) {
              const jsonl = await readFile(file, "utf8").catch(() => "");
              const session = harness.readSession(jsonl, file);
              if (!session || !roots.some((root) => session.cwd === root || session.cwd.startsWith(`${root}/`))) continue;
              out.push({
                conversation: { ai: harness.id, id: session.conversation },
                cwd: session.cwd,
                branches: session.branches,
                ...(session.parent ? { parent: session.parent } : {}),
                startedAt: session.startedAt,
                endedAt: session.endedAt,
                named: jsonl.split(branch).length - 1,
                files: (change?.files ?? []).filter((changed) => jsonl.includes(changed)).length,
              });
            }
          }
          return out;
        });
        return { conversations: workConversations(found, branch, roots, skip), diff: change?.diff ?? null };
      });

    /** The conversation as its harness's lines, readable. */
    const copyOf = (conversation: Conversation) =>
      Effect.promise(async () => {
        const file = transcriptFile(harnesses, conversation.ai, conversation.id);
        if (!file) return null;
        const jsonl = await readFile(file, "utf8").catch(() => null);
        if (jsonl === null) return null;
        const lines = jsonl.split("\n").flatMap((raw) => {
          const line = readLine(harnesses, raw);
          return line ? [line] : [];
        });
        return { lines, title: `${harnessFor(harnesses, conversation.ai)?.name ?? conversation.ai} conversation ${conversation.id}` };
      });

    /** File the ask now: find the work's conversations (or use those the
     *  author named), copy them out, and queue the job that files it.
     *  Says what happened, for the agent who asked or the line on the thread. */
    const fileNow = (held: ReviewAskHeld, on: "allowed" | "yes", named?: ReadonlyArray<string>) =>
      Effect.gen(function* () {
        // nothing to file from: it waits on the author, and the asker is told — never left where it was
        const unreadable = (why: string, extra = "", also: Partial<ReviewAskHeld> = {}) =>
          Effect.gen(function* () {
            yield* move(held, "unreadable", also);
            yield* tellAsker(held, "waiting", extra);
            return `failed: ${why}`;
          });
        const state = yield* store.get;
        const project = roomProjects(state, held.roomId).find((candidate) => sameName(candidate.name, held.project));
        if (!project) return yield* unreadable(`${held.project} is not a project your user shares in this room, so collagen cannot find the work`);
        const branch = yield* branchOfAsk(held);
        if (!branch) return yield* unreadable(`collagen cannot tell which branch ${held.link ?? "the ask"} is — file it yourself with ask-review {request: "${held.id}", …} from the conversation that did the work`);
        const work = yield* findWork(project.path, branch);
        const chosen: ReadonlyArray<Conversation> =
          named && named.length > 0
            ? named.flatMap((id) => (held.conversations ?? work.conversations.map((found) => found.conversation)).filter((conversation) => conversation.id === id || conversation.id.startsWith(id)))
            : work.conversations.map((found) => found.conversation);
        if (chosen.length === 0)
          return yield* unreadable(`no conversation of your user's on this machine worked on branch ${branch}. If this conversation did, file it with ask-review {request: "${held.id}", …}; otherwise tell your user, in one line.`, "no conversation on their machine did this work.", { branch });
        const dir = join(copies, held.id);
        const copied: Array<string> = [];
        for (const [index, conversation] of chosen.entries()) {
          const copy = yield* copyOf(conversation);
          if (!copy) continue;
          const file = join(dir, `conversation-${index + 1}.md`);
          yield* Effect.sync(() => {
            mkdirSync(dir, { recursive: true });
            writeFileSync(file, readable(copy.title, copy.lines));
          });
          copied.push(file);
        }
        if (copied.length === 0) return yield* unreadable(`the conversations that did the work are not readable on this machine`, "", { branch });
        const diffFile = work.diff ? join(dir, "change.diff") : null;
        if (diffFile && work.diff) yield* Effect.sync(() => writeFileSync(diffFile, work.diff!));
        const person = yield* SubscriptionRef.get(nameRef);
        const prompt = filingPrompt({ id: held.id, fromName: held.fromName, branch, ...(held.link ? { link: held.link } : {}) }, copied, diffFile, person, server);
        // filing, and the asker told so, before the job can run: it may file at once
        const filing = yield* move(held, on, { branch, conversations: chosen });
        if (!filing) return `failed: it is ${held.stage} — it cannot be filed from there`;
        yield* tellAsker(held, "filing");
        const said = yield* jobs.file({ roomId: held.roomId, requestId: held.id, title: `review ${branch} for ${held.fromName}`, prompt, cwd: project.path ?? homedir(), reads: [dir] });
        if (said.startsWith("failed")) {
          yield* move(filing, "ended");
          yield* tellAsker(held, "waiting");
        }
        return said;
      });

    // --- the author's end -----------------------------------------------------

    /** An ask arrives: kept, and answered as the author's steering says. The
     *  line their agent reads says what was done and what is theirs to do. */
    const asked = (handle: RoomHandle, message: RoomMessage, seq: number | undefined) =>
      Effect.gen(function* () {
        const ask = message.reviewAsk!;
        const known = yield* heldOf(handle.id, ask.id);
        const id = `requestId: "${ask.id}"`;
        let line: string;
        if (known) {
          line = known.stage === "filed" ? `\nIt is filed: ticket ${known.ticketId}.` : known.stage === "declined" ? "\nYour user declined it." : "";
        } else {
          const held: ReviewAskHeld = {
            roomId: handle.id,
            id: ask.id,
            from: message.from,
            fromName: message.fromName,
            project: message.project,
            threadId: message.threadId,
            ...(ask.branch ? { branch: ask.branch } : {}),
            ...(ask.link ? { link: ask.link } : {}),
            ...(ask.written ? { written: true } : {}),
            stage: "new",
            ts: message.ts,
          };
          yield* keep(held);
          const state = yield* store.get;
          const level = levelOf(state, "review", "others", handle.id);
          const answer = `review-request {${id}, file: true} on their yes, {${id}, decline: their reason} on their no`;
          if (level === "unset") {
            yield* move(held, "held");
            yield* tellAsker(held, "waiting");
            line = `\nYour user's steering for review asks is not chosen, so nothing was filed. Ask them once, in a line, to choose one (set-steering kind review, whose others); then, for this one: ${answer}.`;
          } else if (level === "never") {
            yield* move(held, "held");
            yield* tellAsker(held, "waiting");
            line = `\nTheir steering for review asks is never, so nothing was filed. Tell them it came, in one line; ${answer}.`;
          } else if (level === "ask") {
            yield* move(held, "asked");
            yield* tellAsker(held, "asking");
            line = `\nASK YOUR USER, in one line, whether to file the review ticket from the conversation the work was done in (their steering for review asks is ask first): ${answer}. If this conversation did the work, you may file it yourself instead with ask-review {request: "${ask.id}", …}.`;
          } else {
            const gate = allow(state, "review", "others", false, handle.id);
            const said = "held" in gate ? `failed: ${gate.why}` : yield* fileNow(held, "allowed");
            line = said.startsWith("failed")
              ? `\nTheir steering says to file it, but it could not be: ${said.replace(/^failed: /, "")}`
              : `\nTheir steering for review asks started filing it: ${said}${level === "act" ? " Tell them, in one line." : ""}`;
          }
        }
        yield* inbox.push(handle.id, { ...message, findings: `${message.findings}${line}` }, seq);
        yield* Effect.forkChild(runner.runThread(message.threadId));
      });

    /** The author's word on an ask, or a filing job that cannot file it. */
    const answer = (roomId: string, input: Answer) =>
      Effect.gen(function* () {
        const pending = ((yield* store.get).reviewAsks ?? []).filter((held) => held.roomId === roomId && held.stage !== "filed" && held.stage !== "declined");
        if (!input.requestId) {
          if (pending.length === 0) return "no review asks are waiting on your user";
          return toToon({ asks: pending.map((held) => ({ requestId: held.id, from: held.fromName, project: held.project, branch: held.branch ?? "", link: held.link ?? "", stage: held.stage })) });
        }
        const held = yield* heldOf(roomId, input.requestId);
        if (!held) return `failed: no review ask ${input.requestId} — call review-request with nothing to list them`;
        const refused = (on: AskEvent) => (nextAsk(held.stage, on) === null ? (held.stage === "filed" ? `failed: it is filed already: ticket ${held.ticketId}` : `failed: it is ${held.stage} — that cannot be done from there`) : null);
        if (input.decline !== undefined) {
          if (refused("declined")) return refused("declined")!;
          yield* move(held, "declined");
          yield* tellAsker(held, "declined", input.decline.trim());
          return `declined; ${held.fromName} is told.`;
        }
        if (input.unsure !== undefined) {
          if (refused("unsure")) return refused("unsure")!;
          yield* move(held, "unsure");
          yield* tellAsker(held, "unsure");
          const candidates = yield* Effect.forEach(held.conversations ?? [], (conversation) =>
            copyOf(conversation).pipe(Effect.map((copy) => ({ conversation: conversation.id, ai: conversation.ai, started: copy?.lines[0]?.ts ?? "", opens: (copy?.lines.find((line) => line.who === "user")?.text ?? "").slice(0, 120) }))),
          );
          yield* tellHere(
            held,
            "review-request:unsure",
            `The filing job could not tell which conversation holds the why for ${held.fromName}'s review ask on ${held.branch ?? held.link}: ${input.unsure.trim()}\n${toToon({ candidates })}\nASK YOUR USER, in one line, which to use: review-request {requestId: "${held.id}", file: true, conversations: [its id]}.`,
          );
          return "noted: nothing filed, and your user is asked which conversation to use.";
        }
        if (input.file !== true) return "failed: pass file: true (your user's yes), decline (their no), or nothing to list the asks";
        // their yes lets ask first and never through, never a level not chosen
        const gate = allow(yield* store.get, "review", "others", true, roomId);
        if ("held" in gate) return `failed: ${gate.why} (kind review, whose others)`;
        if (refused("yes")) return refused("yes")!;
        return yield* fileNow(held, "yes", input.conversations);
      });

    /** ask-review filed the ticket an ask asked for: the asker is told. */
    const filed = (roomId: string, requestId: string, ticketId: string, title: string) =>
      Effect.gen(function* () {
        const held = yield* heldOf(roomId, requestId);
        if (!held) return;
        if (!(yield* move(held, "filed", { ticketId }))) return;
        yield* tellAsker(held, "filed", `${title} [${ticketId}]`, ticketId);
      });

    // a filing job that ended without filing leaves the ask with the author —
    // once per job, so a retry of the same ask is not taken for the last one
    const ended = new Set<string>();
    yield* SubscriptionRef.changes(jobs.views).pipe(
      Stream.map((views) => views.filter((view) => view.kind === "filing" && (view.state === "done" || view.state === "failed") && !ended.has(view.id))),
      Stream.tap((finished) =>
        Effect.forEach(finished, (view) =>
          Effect.gen(function* () {
            ended.add(view.id);
            const held = ((yield* store.get).reviewAsks ?? []).find((candidate) => candidate.id === view.ticketId);
            if (!held || held.stage !== "filing") return;
            yield* move(held, "ended");
            yield* tellAsker(held, "waiting");
            yield* tellHere(
              held,
              "review-request:waiting",
              `The filing job for ${held.fromName}'s review ask on ${held.branch ?? held.link} ended without filing it${view.note ? `: ${view.note}` : ""}. Tell your user, in one line: it can be filed with ask-review {request: "${held.id}", …} from the conversation that did the work, retried with review-request {requestId: "${held.id}", file: true}, or declined.`,
            );
          }),
        { discard: true }),
      ),
      Stream.runDrain,
      Effect.forkScoped,
    );

    // --- the asker's end ------------------------------------------------------

    /** Ask a colleague for a review ticket on their work: the ask goes on the
     *  log for them (offline, they get it when back), and is kept here with
     *  the review the person wrote, until it is filed. */
    const ask = (roomId: string, input: AskInput) =>
      Effect.gen(function* () {
        const id = crypto.randomUUID();
        const me = yield* SubscriptionRef.get(nameRef);
        const what = input.branch ? `branch ${input.branch}${input.link ? ` (${input.link})` : ""}` : input.link!;
        const kept: AskedReview = { roomId, id, peer: input.peer.key, project: input.project, ...(input.review ? { review: input.review } : {}), ts: yield* Clock.currentTimeMillis };
        yield* store.update((state) => ({ ...state, askedReviews: [...(state.askedReviews ?? []), kept].slice(-200) }));
        const findings = [
          `${me} asks your user for a review of their work on ${what}, which has no review ticket yet.`,
          input.review ? `${me} has written their review already: it goes on the ticket as their take once it is filed.` : "",
          input.note?.trim() ? `${me}: ${input.note.trim()}` : "",
        ]
          .filter((part) => part.length > 0)
          .join("\n");
        const done = yield* outbox.send({
          roomId,
          to: input.peer.name,
          title: `${input.project} · review ask · ${input.branch ?? input.link}`,
          outgoing: { kind: "message", peer: input.peer.name, project: input.project, intent: "review-request", findings, reviewAsk: { id, ...(input.branch ? { branch: input.branch } : {}), ...(input.link ? { link: input.link } : {}), ...(input.review ? { written: true } : {}) } },
        });
        if (done._tag === "refused") {
          yield* store.update((state) => ({ ...state, askedReviews: (state.askedReviews ?? []).filter((had) => had.id !== id) }));
          return done.text;
        }
        return `${done.text}: asked ${input.peer.name} for a review ticket on ${what}. Their collagen files it from the conversation the work was done in, as their steering allows; each stage comes back on your thread with them, and once it is filed ${input.review ? "your user's review goes on it as their take" : "your user's review step on it arrives"}. TELL YOUR USER ONLY THIS: "asked ${input.peer.name} for a review ticket".`;
      });

    /** The review the person wrote, put on the ticket once it is here: their
     *  own words, given with the ask for this. */
    const postWritten = (handle: RoomHandle, kept: AskedReview, ticketId: string, author: string) =>
      Effect.gen(function* () {
        if (!kept.review) return;
        yield* SubscriptionRef.changes(handle.room.tickets).pipe(
          Stream.filter((all) => all.has(ticketId)),
          Stream.take(1),
          Stream.runDrain,
          Effect.timeout(TICKET_WAIT),
        );
        const said = yield* outbox.tell({
          roomId: handle.id,
          to: author,
          title: `${kept.project} · your review`,
          outgoing: { kind: "post-review", ticketId, findings: kept.review.findings, failed: kept.review.failed ?? false, ...(kept.review.comment ? { comment: true } : {}) },
        });
        yield* Effect.log(`review ask ${kept.id.slice(0, 8)}: your review on ${ticketId.slice(0, 8)} — ${said.split("\n")[0]}`);
      }).pipe(Effect.catch(() => Effect.logWarning(`review ask ${kept.id.slice(0, 8)}: ticket ${ticketId.slice(0, 8)} did not arrive, so your review was not put on it`)));

    /** How far an ask the person made has come: the line their agent reads,
     *  and once filed, their written review put on the ticket. */
    const heard = (handle: RoomHandle, message: RoomMessage, seq: number | undefined) =>
      Effect.gen(function* () {
        const status = message.reviewStatus!;
        const kept = ((yield* store.get).askedReviews ?? []).find((candidate) => candidate.roomId === handle.id && candidate.id === status.id);
        let line = "\nTell your user, in one line.";
        if (status.stage === "filed" && status.ticketId) {
          const ticketId = status.ticketId;
          if (kept?.review && !kept.ticketId) yield* Effect.forkScoped(postWritten(handle, kept, ticketId, message.fromName));
          if (kept) yield* store.update((state) => ({ ...state, askedReviews: (state.askedReviews ?? []).map((had) => (had.id === kept.id ? { ...had, ticketId } : had)) }));
          line = kept?.review
            ? `\nYour user's review goes on it as their take (ticket ${ticketId}). Tell them, in one line.`
            : `\nTheir review step on ticket ${ticketId} comes with it: start the review as their work steering allows (review-context, then the code with them, then post-review in their words).`;
        }
        yield* inbox.push(handle.id, { ...message, findings: `${message.findings}${line}` }, seq);
        yield* Effect.forkChild(runner.runThread(message.threadId));
      });

    // every room, as it appears: asks to the person and news of theirs
    const attached = new Set<string>();
    const attach = (handle: RoomHandle) =>
      handle.room.messages.pipe(
        Stream.filter(({ message }) => message.to === identity.pubkey && (message.reviewAsk !== undefined || message.reviewStatus !== undefined)),
        Stream.tap(({ message, seq }) => (message.reviewAsk ? asked(handle, message, seq) : heard(handle, message, seq))),
        Stream.runDrain,
        Effect.forkScoped,
      );
    yield* SubscriptionRef.changes(rooms.handles).pipe(
      Stream.tap((handles) =>
        Effect.forEach(
          handles.filter((handle) => !attached.has(handle.id)),
          (handle) => {
            attached.add(handle.id);
            return attach(handle);
          },
          { discard: true },
        ),
      ),
      Stream.runDrain,
      Effect.forkScoped,
    );

    return { ask, answer, filed, heldOf, findWork, copyOf } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
