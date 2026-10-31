import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Clock, Context, Effect, Layer, Stream, SubscriptionRef } from "effect";
import { encode as toToon } from "@toon-format/toon";
import { deriveThreadId, roomProjects, type Conversation, type QuestionLines, type ReviewAnswer, type ReviewContext, type ReviewGuess, type ReviewQuestionHeld, type ReviewQuestionStage, type RoomMessage, type Verdict } from "@collagen/p2p";
import { MOST_READ, readable } from "../lib/reviewRequests";
import { nextQuestion, type QuestionEvent } from "../lib/questionMachine";
import { allow, levelOf, type Cause } from "../lib/steering";
import { sameName } from "../lib/names";
import { AgentRunner } from "./AgentRunner";
import { CliArgs } from "./CliArgs";
import { configDir, IdentityService } from "./Identity";
import { Inbox } from "./Inbox";
import { Jobs } from "./Jobs";
import { mcpServerName } from "./mcpAddress";
import { Outbox } from "./Outbox";
import { ReviewRequests } from "./ReviewRequests";
import { Rooms, type RoomHandle } from "./Rooms";
import { StateStore } from "./StateStore";

// A question about a review that its why does not answer, asked from a
// reader's chat on the review page (ask-author). Both ends live here.
//
// The author's end: the question arrives on the room's log, and their
// steering for answers decides — a colleague's question waits on them until
// they raise it; ask first, their agent asks them; act or just do it,
// collagen finds the conversation the work was done in and queues a job that
// reads a copy of it and answers with review-question, without interrupting
// it. The answer goes back to the asker and onto the review's why, marked as
// read from the author's AI. When it finds a flaw, their work steering
// decides: ask first, it is raised with them; act or just do it, it is
// handed to the conversation that built the work, which fixes it there.
//
// The asker's end: each stage, and the answer, reach the asker's chat on the
// review page (ReviewChat follows `heard`).

/** What the asker reads of each stage, in the author's name. */
/** Why a question cannot be answered for now, as the asker reads it. */
const WHY: Record<NonNullable<ReviewAnswer["why"]>, (author: string) => string> = {
  "not-chosen": (author) => `${author} has not turned on answering questions yet, so it waits until they do`,
  never: (author) => `${author} answers no questions on their own, so it waits on their word`,
  "no-conversation": (author) => `no conversation of ${author}'s holds this work, so their AI has nothing to answer from`,
};

const stageText = (stage: ReviewQuestionStage, author: string, extra = ""): string => {
  switch (stage) {
    case "waiting":
      return `Waits on ${author}${extra ? `: ${extra}` : "."}`;
    case "asking":
      return `${author} is asked whether their AI may answer.`;
    case "answering":
      return `${author}'s AI is reading the conversation the work was done in.`;
    case "answered":
      return `${author}'s AI answered${extra ? `: ${extra}` : "."}`;
    case "declined":
      return `${author} declined${extra ? `: ${extra}` : "."}`;
    case "addressing":
      return `${author}'s AI is fixing it in the conversation the work was done in${extra ? `: ${extra}` : "."}`;
  }
};

/** What an answering job is told: the conversations to read, the question,
 *  and how to answer — with review-question, never in the room otherwise. */
const answeringPrompt = (held: ReviewQuestionHeld, title: string, files: ReadonlyArray<string>, diff: string | null, person: string, server: string): string =>
  [
    `${held.fromName} is reading ${person}'s review "${title}" and asks something its why does not answer. You answer it for ${person}, from the conversation the work was done in: what was decided there and why, never a guess.`,
    `Read: ${files.join(", ")}${diff ? `, and the change itself, ${diff}` : ""}. The review's why is in the ${server} review-context tool, ticketId "${held.ticketId}".`,
    held.lines ? `The question is about ${held.lines.file}, lines ${held.lines.from.line}–${held.lines.to.line}${held.commit ? ` at commit ${held.commit}` : ""}:\n\`\`\`diff\n${held.lines.text}\n\`\`\`` : "",
    `The question: ${held.question}`,
    held.guess ? `${held.fromName}'s AI could not wait for an answer and assumed: "${held.guess.what}". Say whether that holds, with verdict: "confirmed" (it does), "corrected" (partly: reply with the real reason) or "wrong" (reply with the real reason).` : "",
    `Answer with the ${server} review-question tool: {questionId: "${held.id}", reply: what the conversation says, briefly, in plain words}. If the conversation does not say, reply that it does not, and what it does say nearby. If answering shows something wrong with the change — a case it misses, a reason that no longer holds — add flaw: what is wrong, in a line. Read only: you change nothing.`,
  ]
    .filter((part) => part.length > 0)
    .join("\n\n");

/** What the person's tool says to a question (review-question). */
export interface Respond {
  readonly questionId?: string;
  /** their yes: let their AI answer it */
  readonly answer?: boolean;
  readonly decline?: string;
  /** the answer itself — from the answering job, or written with them */
  readonly reply?: string;
  readonly flaw?: string;
  /** on a reader's AI's guess at it: whether it holds */
  readonly verdict?: Verdict;
}

/** A question the person asks of a review's author (ask-author). */
export interface AskAuthor {
  /** the question's id, when the asker's chat already named it */
  readonly id?: string;
  readonly ticketId: string;
  readonly question: string;
  readonly lines?: QuestionLines;
  readonly commit?: string;
}

/** Who answers a question about the person's own review: the conversation
 *  of theirs that did the work. The chat names it so. */
export const OWN = "you";

/** An answer, or a stage, come back to a question the person asked. */
export interface Heard {
  readonly roomId: string;
  readonly fromName: string;
  readonly answer: ReviewAnswer;
}

export class ReviewQuestions extends Context.Service<ReviewQuestions>()("cli/ReviewQuestions", {
  make: Effect.gen(function* () {
    const rooms = yield* Rooms;
    const store = yield* StateStore;
    const jobs = yield* Jobs;
    const inbox = yield* Inbox;
    const outbox = yield* Outbox;
    const runner = yield* AgentRunner;
    const requests = yield* ReviewRequests;
    const { profile } = yield* CliArgs;
    const { identity, nameRef } = yield* IdentityService;
    const server = mcpServerName(profile);
    const copies = join(configDir, `review-questions-${profile}`);
    /** what came back to the person's questions, latest last: the chat follows it */
    const heard = yield* SubscriptionRef.make<ReadonlyArray<Heard>>([]);

    const handleOf = (roomId: string) => SubscriptionRef.get(rooms.handles).pipe(Effect.map((all) => all.find((handle) => handle.id === roomId)));
    const heldOf = (roomId: string, id: string) => store.get.pipe(Effect.map((state) => (state.reviewQuestions ?? []).find((held) => held.roomId === roomId && held.id === id)));
    const keep = (held: ReviewQuestionHeld) =>
      store.update((state) => ({ ...state, reviewQuestions: [...(state.reviewQuestions ?? []).filter((had) => !(had.roomId === held.roomId && had.id === held.id)), held].slice(-200) }));
    const causeOf = (held: ReviewQuestionHeld): Cause => (held.from === identity.pubkey ? "mine" : "others");
    /** A question moved by an event, as the machine's table says (lib/questionMachine) — or refused,
     *  when its state has no such move: it never lands somewhere the table does not say. */
    const move = (held: ReviewQuestionHeld, on: QuestionEvent, also: Partial<ReviewQuestionHeld> = {}) =>
      Effect.gen(function* () {
        const to = nextQuestion(held.stage, on);
        if (to === null) {
          yield* Effect.logWarning(`review question ${held.id.slice(0, 8)}: "${on}" has no move from ${held.stage} — refused`);
          return null;
        }
        const moved: ReviewQuestionHeld = { ...held, ...also, stage: to };
        yield* keep(moved);
        return moved;
      });

    /** Tell the asker how their question stands: collagen's record of it on
     *  the thread between them, and the answer once there is one. Asked about
     *  the person's own review (single player), it never leaves this machine. */
    const tellAsker = (held: ReviewQuestionHeld, stage: ReviewQuestionStage, extra = "", said: { readonly answer?: string; readonly flaw?: string; readonly why?: ReviewAnswer["why"] } = {}) =>
      Effect.gen(function* () {
        const answer: ReviewAnswer = { id: held.id, ticketId: held.ticketId, stage, ...(said.answer ? { answer: said.answer } : {}), ...(said.flaw ? { flaw: said.flaw } : {}), ...(said.why ? { why: said.why } : {}) };
        if (held.from === identity.pubkey) {
          yield* Effect.log(`review question ${held.id.slice(0, 8)} (your own review): ${stage}`);
          return yield* SubscriptionRef.update(heard, (all) => [...all, { roomId: held.roomId, fromName: OWN, answer }].slice(-200));
        }
        const handle = yield* handleOf(held.roomId);
        if (!handle) return yield* Effect.logWarning(`review question ${held.id.slice(0, 8)}: its room is gone, so ${held.fromName} is not told it is ${stage}`);
        const author = yield* SubscriptionRef.get(nameRef);
        yield* Effect.log(`review question ${held.id.slice(0, 8)} → ${held.fromName}: ${stage}`);
        yield* handle.room
          .sendTo(held.from, {
            project: held.project,
            intent: `review-question:${stage}`,
            findings: stageText(stage, author, extra),
            ticketId: held.ticketId,
            reviewAnswer: answer,
          })
          .pipe(Effect.catchTag("NotWritable", () => Effect.logWarning("cannot tell the asker how their question stands: not admitted to the room log")));
      });

    /** Put a line for the person's agent on the question's thread, and wake
     *  the conversation that holds it, as their delivery steering allows. */
    const tellHere = (held: ReviewQuestionHeld, intent: string, findings: string) =>
      Effect.gen(function* () {
        const message: RoomMessage = { id: crypto.randomUUID(), threadId: held.threadId, from: held.from, fromName: held.fromName, to: identity.pubkey, project: held.project, intent, findings, ts: yield* Clock.currentTimeMillis, ticketId: held.ticketId };
        yield* inbox.push(held.roomId, message);
        yield* Effect.forkChild(runner.runThread(held.threadId));
      });

    /** The review a question is about, with its project's folder here. */
    const reviewOf = (roomId: string, ticketId: string) =>
      Effect.gen(function* () {
        const handle = yield* handleOf(roomId);
        if (!handle) return null;
        const ticket = (yield* SubscriptionRef.get(handle.room.tickets)).get(ticketId);
        const review = (yield* SubscriptionRef.get(handle.room.reviews)).find((candidate) => candidate.ticketId === ticketId);
        if (!ticket || !review) return null;
        const project = roomProjects(yield* store.get, roomId).find((candidate) => sameName(candidate.name, ticket.project));
        return { handle, ticket, review, path: project?.path ?? null };
      });

    /** The review's why as the author's collagen revises it: written as it
     *  is, so its stamp still names the conversation that filed it — never the
     *  answering job's, which would then be taken for the work. */
    const rewrite = (roomId: string, review: ReviewContext) =>
      Effect.gen(function* () {
        const handle = yield* handleOf(roomId);
        if (!handle) return;
        yield* handle.room.shareReview(review).pipe(Effect.catch(() => Effect.logWarning("cannot revise the review's why: not admitted to the room log")));
      });

    // --- the author's end -----------------------------------------------------

    /** Answer now: find the work's conversations, copy them out, and queue
     *  the job that answers. Says what happened. */
    const answerNow = (held: ReviewQuestionHeld, on: "allowed" | "yes") =>
      Effect.gen(function* () {
        const found = yield* reviewOf(held.roomId, held.ticketId);
        const unreadable = (why: string) =>
          Effect.gen(function* () {
            yield* move(held, "unreadable");
            yield* tellAsker(held, "waiting", `${WHY["no-conversation"](yield* SubscriptionRef.get(nameRef))}.`, { why: "no-conversation" });
            return `failed: ${why}`;
          });
        if (!found) return yield* unreadable(`no review ${held.ticketId} of your user's in this room`);
        if (!found.path) return yield* unreadable(`${found.ticket.project} is not a project your user has on this machine, so collagen cannot find the work`);
        if (!found.review.branch) return yield* unreadable(`the review names no branch, so collagen cannot find the conversation the work was done in`);
        // the review names the conversation that filed it: that one first, as the work. Others that acted on this
        // review are its readers — a reviewer's guesses are never the author's reasons — so they are skipped
        const filer = found.review.conversation;
        const key = (conversation: Conversation) => `${conversation.ai}:${conversation.id}`;
        const readers = filer ? Object.values((yield* store.get).worked ?? {}).filter((worked) => worked.tickets.includes(held.ticketId) && key(worked.conversation) !== key(filer)).map((worked) => key(worked.conversation)) : [];
        const work = yield* requests.findWork(found.path, found.review.branch, new Set(readers));
        const ownJobs = new Set((yield* store.get).jobConversations ?? []);
        const filerHere = filer !== undefined && !ownJobs.has(key(filer)) ? (yield* requests.copyOf(filer)) !== null : false;
        const filed: ReadonlyArray<Conversation> = filerHere && filer ? [filer] : [];
        const chosen: ReadonlyArray<Conversation> = [...filed, ...work.conversations.map((one) => one.conversation).filter((conversation) => !filed.some((first) => key(first) === key(conversation)))].slice(0, MOST_READ);
        if (chosen.length === 0)
          return yield* unreadable(`no conversation of your user's on this machine worked on branch ${found.review.branch}. If this conversation did, answer it yourself with review-question {questionId: "${held.id}", reply: …}; otherwise tell your user, in one line.`);
        const dir = join(copies, held.id);
        const copied: Array<string> = [];
        for (const [index, conversation] of chosen.entries()) {
          const copy = yield* requests.copyOf(conversation);
          if (!copy) continue;
          const file = join(dir, `conversation-${index + 1}.md`);
          yield* Effect.sync(() => {
            mkdirSync(dir, { recursive: true });
            writeFileSync(file, readable(copy.title, copy.lines));
          });
          copied.push(file);
        }
        if (copied.length === 0) return yield* unreadable(`the conversations that did the work are not readable on this machine`);
        const diffFile = work.diff ? join(dir, "change.diff") : null;
        if (diffFile && work.diff) yield* Effect.sync(() => writeFileSync(diffFile, work.diff!));
        const person = yield* SubscriptionRef.get(nameRef);
        const title = found.ticket.title ?? found.ticket.goal;
        // answering, and the asker told so, before the job can run: it may answer at once
        const answering = yield* move(held, on, { conversations: chosen });
        if (!answering) return `failed: it is ${held.stage} — it cannot be answered from there`;
        yield* tellAsker(held, "answering");
        const said = yield* jobs.file({ roomId: held.roomId, requestId: held.id, title: `answer ${held.fromName} on "${title}"`, prompt: answeringPrompt(held, title, copied, diffFile, person, server), cwd: found.path ?? homedir(), reads: [dir] }, "answering");
        if (said.startsWith("failed")) {
          yield* move(answering, "ended");
          yield* tellAsker(held, "waiting");
        }
        return said;
      });

    /** A question arrives: kept, and answered as the author's steering says.
     *  The line their agent reads says what was done and what is theirs to do. */
    const asked = (handle: RoomHandle, message: RoomMessage, seq: number | undefined) =>
      Effect.gen(function* () {
        const question = message.reviewQuestion!;
        const known = yield* heldOf(handle.id, question.id);
        const id = `questionId: "${question.id}"`;
        let line = "";
        if (!known) {
          const held: ReviewQuestionHeld = {
            roomId: handle.id,
            id: question.id,
            ticketId: question.ticketId,
            from: message.from,
            fromName: message.fromName,
            project: message.project,
            threadId: message.threadId,
            question: question.question,
            ...(question.lines ? { lines: question.lines } : {}),
            ...(question.commit ? { commit: question.commit } : {}),
            stage: "new",
            ts: message.ts,
          };
          yield* keep(held);
          const state = yield* store.get;
          const cause = causeOf(held);
          const level = levelOf(state, "answer", cause, handle.id);
          const reply = `review-question {${id}, answer: true} on their yes, {${id}, decline: their reason} on their no — or answer it yourself from this conversation, if it did the work: {${id}, reply: …}`;
          if (level === "unset" || level === "never" || level === "ask") {
            yield* move(held, level === "ask" ? "asked" : "held");
            const author = yield* SubscriptionRef.get(nameRef);
            if (level === "ask") yield* tellAsker(held, "asking");
            else yield* tellAsker(held, "waiting", `${WHY[level === "never" ? "never" : "not-chosen"](author)}.`, { why: level === "never" ? "never" : "not-chosen" });
            line =
              level === "unset"
                ? `\nYour user's steering for answers is not chosen, so nothing was answered. Ask them once, in a line, to choose one (set-steering kind answer, whose ${cause}); then, for this one: ${reply}.`
                : level === "never"
                  ? `\nTheir steering for answers is never, so nothing was answered. Tell them it came, in one line; ${reply}.`
                  : `\nASK YOUR USER, in one line, whether their AI may answer it from the conversation the work was done in (their steering for answers is ask first): ${reply}.`;
          } else {
            const gate = allow(state, "answer", cause, false, handle.id);
            const said = "held" in gate ? `failed: ${gate.why}` : yield* answerNow(held, "allowed");
            line = said.startsWith("failed")
              ? `\nTheir steering says to answer it, but it could not be: ${said.replace(/^failed: /, "")}`
              : `\nTheir steering for answers started answering it: ${said}${level === "act" ? " Tell them, in one line." : ""}`;
          }
        }
        yield* inbox.push(handle.id, { ...message, findings: `${message.findings}${line}` }, seq);
        yield* Effect.forkChild(runner.runThread(message.threadId));
      });

    /** The answer put on the review's why, marked as read from the author's
     *  AI: the next reader does not ask again. */
    const intoTheWhy = (held: ReviewQuestionHeld, reply: string) =>
      Effect.gen(function* () {
        const found = yield* reviewOf(held.roomId, held.ticketId);
        if (!found) return;
        const ids = new Set(found.review.decisions.map((decision) => decision.id));
        let next = found.review.decisions.length + 1;
        while (ids.has(`d${next}`)) next++;
        const title = held.question.length > 60 ? `${held.question.slice(0, 57).trimEnd()}…` : held.question;
        const decision = {
          id: `d${next}`,
          title,
          what: reply,
          agentWhy: reply,
          where: held.lines ? [`${held.lines.file}:${held.lines.from.line}`] : [],
          basis: `read from ${yield* SubscriptionRef.get(nameRef)}'s AI, from the conversation the work was done in, answering ${held.fromName}'s question — not told by them`,
        };
        yield* rewrite(held.roomId, { ...found.review, decisions: [...found.review.decisions, decision], ts: yield* Clock.currentTimeMillis });
      });

    /** A flaw the answer found: raised with the author, or handed to the
     *  conversation that built the work, as their work steering says. */
    const flawed = (held: ReviewQuestionHeld, flaw: string) =>
      Effect.gen(function* () {
        const state = yield* store.get;
        const level = levelOf(state, "work", causeOf(held), held.roomId);
        const builder = held.conversations?.[0];
        const what = `${held.fromName}'s question on your user's review (ticket ${held.ticketId}) found something wrong: ${flaw}`;
        if ((level === "act" || level === "auto") && builder) {
          // the conversation that built the work hears the thread from now on, and fixes it there
          yield* store.update((now) => ({ ...now, threads: { ...now.threads, [held.threadId]: { ai: builder.ai, sessionId: builder.id, since: Date.now() } } }));
          yield* tellAsker(held, "addressing", flaw);
          yield* tellHere(
            held,
            "review-question:fix",
            `${what}\nYour user's work steering says ${level === "act" ? "act, then tell" : "just do it"}: fix it in this branch, push it, and then tell ${held.fromName} it is addressed, with send-to-peer (ticketId "${held.ticketId}").${level === "act" ? " Tell your user, in one line, that you are on it." : ""}`,
          );
          return "handed to the conversation the work was done in";
        }
        yield* tellHere(held, "review-question:flaw", `${what}\nASK YOUR USER, in one line, whether to fix it (their work steering is ${level === "unset" ? "not chosen" : level}); on their yes, fix it in the branch and tell ${held.fromName} with send-to-peer (ticketId "${held.ticketId}").`);
        return "raised with your user";
      });

    /** One decision on the review's why changed, as the author's collagen writes it. */
    const changeDecision = (held: ReviewQuestionHeld, id: string, update: (decision: ReviewContext["decisions"][number]) => ReviewContext["decisions"][number]) =>
      Effect.gen(function* () {
        const found = yield* reviewOf(held.roomId, held.ticketId);
        if (!found || !found.review.decisions.some((decision) => decision.id === id)) return;
        yield* rewrite(held.roomId, { ...found.review, decisions: found.review.decisions.map((decision) => (decision.id === id ? update(decision) : decision)), ts: yield* Clock.currentTimeMillis });
      });

    /** A reader's AI guessed at a reason the review does not give: added to
     *  the why at once, plainly a guess, for the author to settle. */
    const guessed = (handle: RoomHandle, message: RoomMessage, seq: number | undefined) =>
      Effect.gen(function* () {
        const guess = message.reviewGuess!;
        const held = yield* heldOf(handle.id, guess.id);
        const found = yield* reviewOf(handle.id, guess.ticketId);
        if (!held || !found || found.ticket.createdBy !== identity.pubkey || held.guess) return yield* inbox.push(handle.id, message, seq);
        const ids = new Set(found.review.decisions.map((decision) => decision.id));
        let next = found.review.decisions.length + 1;
        while (ids.has(`d${next}`)) next++;
        const id = `d${next}`;
        const title = held.question.length > 60 ? `${held.question.slice(0, 57).trimEnd()}…` : held.question;
        const decision = { id, title, what: guess.what, agentWhy: guess.what, where: held.lines ? [`${held.lines.file}:${held.lines.from.line}`] : [], basis: `${message.fromName}'s AI assumes this, as ${yield* SubscriptionRef.get(nameRef)} could not answer: ${guess.basis}`, confidence: guess.confidence };
        yield* rewrite(handle.id, { ...found.review, decisions: [...found.review.decisions, decision], ts: yield* Clock.currentTimeMillis });
        yield* keep({ ...held, guess: { decision: id, what: guess.what } });
        const line = `\n${message.fromName}'s AI assumed why, as your user could not answer: "${guess.what}". It is on your user's review's why as a guess (${id}). When they say whether it holds: review-question {questionId: "${held.id}", verdict: confirmed | corrected | wrong, reply: the real reason when it is not}.`;
        yield* inbox.push(handle.id, { ...message, findings: `${message.findings}${line}` }, seq);
        yield* Effect.forkChild(runner.runThread(message.threadId));
      });

    /** The guess settled: confirmed as it is, corrected (the real reason in
     *  its place, the guess kept beside it), or wrong. */
    const settleGuess = (held: ReviewQuestionHeld, verdict: Verdict, reply: string | undefined) =>
      changeDecision(held, held.guess!.decision, (decision) =>
        verdict === "corrected" && reply
          ? { ...decision, what: reply, agentWhy: reply, verdict, guess: { what: decision.what, ...(decision.basis ? { basis: decision.basis } : {}) } }
          : { ...decision, verdict },
      );

    /** The author's word on a question, or the answering job's answer. */
    const respond = (roomId: string, input: Respond) =>
      Effect.gen(function* () {
        const pending = ((yield* store.get).reviewQuestions ?? []).filter((held) => held.roomId === roomId && held.stage !== "answered" && held.stage !== "declined" && held.stage !== "addressing");
        if (!input.questionId) {
          if (pending.length === 0) return "no questions about your user's reviews are waiting";
          return toToon({ questions: pending.map((held) => ({ questionId: held.id, from: held.fromName, ticketId: held.ticketId, question: held.question, lines: held.lines ? `${held.lines.file}:${held.lines.from.line}` : "", stage: held.stage })) });
        }
        const held = yield* heldOf(roomId, input.questionId);
        if (!held) return `failed: no question ${input.questionId} — call review-question with nothing to list them`;
        const refused = (on: QuestionEvent) => (nextQuestion(held.stage, on) === null ? `failed: it is ${held.stage === "addressing" ? "answered and being fixed" : held.stage} — that cannot be done from there` : null);
        if (input.decline !== undefined) {
          if (refused("declined")) return refused("declined")!;
          yield* move(held, "declined");
          yield* tellAsker(held, "declined", input.decline.trim());
          return `declined; ${held.fromName} is told.`;
        }
        if (input.verdict !== undefined && input.reply === undefined) {
          if (!held.guess) return "failed: nobody has guessed at it — there is no guess to settle; reply with the answer instead";
          if (input.verdict !== "confirmed") return "failed: a guess that does not hold needs the real reason: reply with it";
          if (refused("answered")) return refused("answered")!;
          yield* settleGuess(held, "confirmed", undefined);
          yield* move(held, "answered");
          yield* tellAsker(held, "answered", "", { answer: `${yield* SubscriptionRef.get(nameRef)} confirms the reason your AI assumed: ${held.guess.what}` });
          return `confirmed; ${held.fromName} is told, and the guess on the review's why is marked confirmed.`;
        }
        if (input.reply !== undefined) {
          const reply = input.reply.trim();
          if (!reply) return "failed: reply with what the conversation says";
          const flaw = input.flaw?.trim() || undefined;
          // a flaw their work steering hands to the conversation that built it is "being fixed"; any other answer, "answered"
          const level = levelOf(yield* store.get, "work", causeOf(held), roomId);
          const handed = flaw !== undefined && (level === "act" || level === "auto") && (held.conversations?.length ?? 0) > 0;
          if (refused(handed ? "fixing" : "answered")) return refused(handed ? "fixing" : "answered")!;
          yield* move(held, handed ? "fixing" : "answered");
          yield* tellAsker(held, "answered", "", { answer: reply, ...(flaw ? { flaw } : {}) });
          // a guess already on the why is settled by the answer; with none, the answer goes on as read from the author's AI
          if (held.guess) {
            const verdict = input.verdict ?? "corrected";
            yield* settleGuess(held, verdict, reply);
            if (verdict === "wrong") yield* intoTheWhy(held, reply);
          } else yield* intoTheWhy(held, reply);
          const then = flaw ? ` It found a flaw: ${yield* flawed(held, flaw)}.` : "";
          return `answered; ${held.fromName} has it, and the review's why has it, marked as read from your user's AI.${then}`;
        }
        if (input.answer !== true) return "failed: pass answer: true (your user's yes), decline (their no), reply (the answer), or nothing to list the questions";
        // their yes lets ask first and never through, never a level not chosen
        const gate = allow(yield* store.get, "answer", causeOf(held), true, roomId);
        if ("held" in gate) return `failed: ${gate.why} (kind answer)`;
        if (refused("yes")) return refused("yes")!;
        return yield* answerNow(held, "yes");
      });

    // an answering job that ended without answering leaves the question with the author
    const ended = new Set<string>();
    yield* SubscriptionRef.changes(jobs.views).pipe(
      Stream.map((views) => views.filter((view) => view.kind === "answering" && (view.state === "done" || view.state === "failed") && !ended.has(view.id))),
      Stream.tap((finished) =>
        Effect.forEach(
          finished,
          (view) =>
            Effect.gen(function* () {
              ended.add(view.id);
              const held = ((yield* store.get).reviewQuestions ?? []).find((candidate) => candidate.id === view.ticketId);
              if (!held || held.stage !== "answering") return;
              yield* move(held, "ended");
              yield* tellAsker(held, "waiting");
              yield* tellHere(
                held,
                "review-question:waiting",
                `The job answering ${held.fromName}'s question ("${held.question}") ended without answering${view.note ? `: ${view.note}` : ""}. Tell your user, in one line: it can be answered with review-question {questionId: "${held.id}", reply: …} from the conversation that did the work, retried with {questionId: "${held.id}", answer: true}, or declined.`,
              );
            }),
          { discard: true },
        ),
      ),
      Stream.runDrain,
      Effect.forkScoped,
    );

    // --- the asker's end ------------------------------------------------------

    /** Ask a review's author's AI what its why does not say: the question
     *  goes on the log for them (offline, they get it when back). */
    const ask = (roomId: string, input: AskAuthor) =>
      Effect.gen(function* () {
        const found = yield* reviewOf(roomId, input.ticketId);
        if (!found) return `failed: no review ticket ${input.ticketId} in this room`;
        const author = found.review.authorName;
        const id = input.id ?? crypto.randomUUID();
        const question = { id, ticketId: input.ticketId, question: input.question, ...(input.lines ? { lines: input.lines } : {}), ...(input.commit ? { commit: input.commit } : {}) };
        // single player: the person's own review — the conversation of theirs that did the work answers, as their own answering steering says, and nothing goes to the room
        if (found.ticket.createdBy === identity.pubkey) {
          const me = yield* SubscriptionRef.get(nameRef);
          const message: RoomMessage = { id: crypto.randomUUID(), threadId: deriveThreadId(identity.pubkey, identity.pubkey, found.ticket.project), from: identity.pubkey, fromName: me, to: identity.pubkey, project: found.ticket.project, intent: "review-question", findings: `Your user asks about their own review "${found.ticket.title ?? found.ticket.goal}"${input.lines ? `, ${input.lines.file} line ${input.lines.from.line}` : ""}: ${input.question}`, ts: yield* Clock.currentTimeMillis, ticketId: input.ticketId, reviewQuestion: question };
          yield* asked(found.handle, message, undefined);
          return `asked the conversation that did the work, on this machine: it answers as your user's answering steering for their own questions says, and the answer comes back to the review page's chat and onto the review's why. TELL YOUR USER ONLY THIS: "asked the conversation that did the work".`;
        }
        const done = yield* outbox.send({
          roomId,
          to: author,
          title: `${found.ticket.project} · question on "${found.ticket.title ?? found.ticket.goal}"`,
          outgoing: {
            kind: "message",
            peer: author,
            project: found.ticket.project,
            intent: "review-question",
            findings: `${yield* SubscriptionRef.get(nameRef)} asks about your user's review "${found.ticket.title ?? found.ticket.goal}"${input.lines ? `, ${input.lines.file} line ${input.lines.from.line}` : ""}: ${input.question}`,
            ticketId: input.ticketId,
            reviewQuestion: question,
          },
        });
        if (done._tag === "refused") return done.text;
        const sent: Heard = { roomId, fromName: author, answer: { id, ticketId: input.ticketId, stage: "waiting" } };
        yield* SubscriptionRef.update(heard, (all) => [...all, sent].slice(-200));
        return `${done.text}: asked ${author}'s AI. Their collagen answers from the conversation the work was done in, as their steering allows; the answer comes back to the review page's chat and onto the review's why. TELL YOUR USER ONLY THIS: "asked ${author}'s AI".`;
      });

    /** A guess at a reason the author could not give, sent to their review's
     *  why, as the reader's AI made it on the reader's word. */
    const assume = (roomId: string, guess: ReviewGuess) =>
      Effect.gen(function* () {
        const found = yield* reviewOf(roomId, guess.ticketId);
        if (!found) return `failed: no review ticket ${guess.ticketId} in this room`;
        const author = found.review.authorName;
        if (found.ticket.createdBy === identity.pubkey) {
          const message: RoomMessage = { id: crypto.randomUUID(), threadId: deriveThreadId(identity.pubkey, identity.pubkey, found.ticket.project), from: identity.pubkey, fromName: yield* SubscriptionRef.get(nameRef), to: identity.pubkey, project: found.ticket.project, intent: "review-guess", findings: `Your AI assumes why: ${guess.what}`, ts: yield* Clock.currentTimeMillis, ticketId: guess.ticketId, reviewGuess: guess };
          yield* guessed(found.handle, message, undefined);
          return "sent: it goes on your user's review's why as a guess, for the conversation that did the work to confirm, correct or reject.";
        }
        const done = yield* outbox.send({
          roomId,
          to: author,
          title: `${found.ticket.project} · a guess at "${found.ticket.title ?? found.ticket.goal}"`,
          outgoing: { kind: "message", peer: author, project: found.ticket.project, intent: "review-guess", findings: `${yield* SubscriptionRef.get(nameRef)}'s AI assumes why: ${guess.what}`, ticketId: guess.ticketId, reviewGuess: guess },
        });
        return done._tag === "refused" ? done.text : `sent: it goes on ${author}'s review's why as a guess, for them to confirm, correct or reject.`;
      });

    /** How a question the person asked stands: kept for the chat, and on
     *  their inbox for their agent — with, when the author cannot answer for
     *  now, what to offer instead of a guess. */
    const answered = (handle: RoomHandle, message: RoomMessage, seq: number | undefined) =>
      Effect.gen(function* () {
        const back = message.reviewAnswer!;
        yield* SubscriptionRef.update(heard, (all) => [...all, { roomId: handle.id, fromName: message.fromName, answer: back }].slice(-200));
        const offer = back.why
          ? `\nTell your user, in one line, that ${message.fromName}'s AI cannot answer for now, and why; then offer, instead of a guess: your own reading of why it is this way, plainly marked as an assumption, or a critical look at it — what may be wrong, and what they would ask ${message.fromName} to change.`
          : "";
        yield* inbox.push(handle.id, { ...message, findings: `${message.findings}${offer}` }, seq);
      });

    // every room, as it appears: questions to the person and news of theirs
    const attached = new Set<string>();
    const attach = (handle: RoomHandle) =>
      handle.room.messages.pipe(
        Stream.filter(({ message }) => message.to === identity.pubkey && (message.reviewQuestion !== undefined || message.reviewAnswer !== undefined || message.reviewGuess !== undefined)),
        Stream.tap(({ message, seq }) => (message.reviewQuestion ? asked(handle, message, seq) : message.reviewGuess ? guessed(handle, message, seq) : answered(handle, message, seq))),
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

    return { ask, respond, heard, assume } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
