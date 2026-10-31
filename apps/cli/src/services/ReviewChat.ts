import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Context, Effect, Fiber, Layer, Option, Stream, SubscriptionRef } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import type { ChatAsked, ChatSelection, ChatTurn, ChatView } from "@collagen/review-web/data";
import { Adapters } from "./Adapters";
import type { ChatEvent } from "./ChatAdapters";
import { CliArgs } from "./CliArgs";
import { McpInfo } from "./McpInfo";
import { mcpServerName } from "./mcpAddress";
import { StateStore } from "./StateStore";
import { commitIn, reviewNamed, reviewTree } from "./ReviewView";
import { draftComments } from "./ReviewTalk";
import { harnessFor, Harnesses, transcriptFile } from "./Harness";
import { shownAi } from "../lib/jobs";
import { readLine, type TranscriptLine } from "../lib/transcripts";
import { levelOf } from "../lib/steering";
import { IdentityService } from "./Identity";
import { ReviewQuestions } from "./ReviewQuestions";
import type { Rooms } from "./Rooms";
import type { ChatTurnKept, ReviewAnswer, ReviewQuestionStage } from "@collagen/p2p";

// The reader's conversation with their own AI on the review page: they
// select code, ask, and the answer streams into the page as it is written —
// no going back to a terminal. Collagen brings no model: it runs the CLI the
// reader uses (the one their conversations work in most, or a mock) through its harness's chat, in
// their clone, read-only, and goes on with the same conversation for the
// next question. One conversation per review: every tab on the review shows
// it, and a reload finds it again. The AI keeps the conversation itself; the
// person's state keeps only where it is (which AI, its conversation id), so
// after a restart the next question re-enters the same conversation and
// the earlier turns are read back from the AI's own log. Nothing of it
// leaves the machine.

interface Chat {
  readonly turns: ReadonlyArray<ChatTurn>;
  /** the AI's conversation, to resume — and which AI it is with */
  readonly session: { readonly ai: string; readonly id: string } | null;
  /** the answer under way: its turn, and the fiber running it */
  readonly running: { readonly turn: string; readonly fiber: Fiber.Fiber<void> } | null;
}

const EMPTY: Chat = { turns: [], session: null, running: null };
/** The most turns a conversation keeps on the page. */
const KEEP = 50;
/** Text streamed in is shown at most this often: a batch per beat, not a page update per word. */
const BEAT = "60 millis";

/** What the reader is reading, for the AI's first question: the review, its
 *  commit, and how to read the code at it. */
const preamble = (review: { readonly title: string; readonly branch?: string; readonly base?: string; readonly commit: string | null; readonly ticketId: string; readonly serverName: string; readonly clone: boolean }): string =>
  [
    `Your user is reading a code review on collagen's review page and asks you about it there; your answer streams into that page as you write it.`,
    `The review: "${review.title}"${review.branch ? ` — branch ${review.branch} into ${review.base ?? "main"}` : ""}${review.commit ? `, at commit ${review.commit}` : ""}. Its why (the author's decisions) is in the ${review.serverName} review-context tool, ticketId "${review.ticketId}".`,
    !review.clone
      ? `There is no clone of the project here: what they show you is the code you have.`
      : review.commit
        ? `This folder is a clone of the project, but its working tree may be at another commit: read the review's code with \`git show ${review.commit}:<path>\`.`
        : `This folder is a clone of the project.`,
    `Answer what they ask, briefly, in plain text (code in fenced blocks). You read; you change nothing — no edits, no messages, nothing posted.`,
    `If neither the code nor the review's why answers it — the reason is the author's, and nothing here says it — never guess: say so in a line, and end your answer with one last line \`${FORWARD} <the question, standalone, for the author>\`. Collagen may then ask the author's AI, which answers from the conversation the work was done in.`,
  ].join("\n");

const asked = (selection: ChatSelection | null, question: string): string => {
  if (!selection) return `${QUESTION}${question}`;
  const lines = selection.from.line === selection.to.line && selection.from.side === selection.to.side ? `line ${selection.to.line}` : `lines ${selection.from.line}–${selection.to.line}`;
  return [`They selected ${selection.file}, ${lines} of the diff:`, "```diff", selection.text, "```", `${QUESTION}${question}`].join("\n");
};

/** What the AI is sent for a question: the opening on a new conversation;
 *  on a follow-up, the commit the page shows now if it moved since the last
 *  question — the AI reads the code the reader is looking at, never the tip. */
export const promptFor = (parts: { readonly opening: string | null; readonly moved: string | null; readonly now: string }): string =>
  parts.opening !== null
    ? `${parts.opening}\n\n${parts.now}`
    : parts.moved !== null
      ? `The page now shows commit ${parts.moved}: read the review's code with \`git show ${parts.moved}:<path>\`.\n\n${parts.now}`
      : parts.now;

const QUESTION = "Their question: ";
/** The line a chat answer ends with when only the author can answer it. */
const FORWARD = "ASK THE AUTHOR:";

/** An answer and the question it hands to the author, when it ends with one. */
export const forwardOf = (answer: string): { readonly answer: string; readonly question: string } | null => {
  const at = answer.lastIndexOf(FORWARD);
  if (at < 0) return null;
  const question = answer.slice(at + FORWARD.length).trim().replace(/`+$/, "").trim();
  return question ? { answer: answer.slice(0, at).replace(/`?\s*$/, "").trim(), question } : null;
};

/** Why an author cannot answer for now, as the reader reads it. */
const CANNOT: Record<NonNullable<ReviewAnswer["why"]>, (author: string) => string> = {
  "not-chosen": (author) => `${author} hasn't turned on answering questions yet, so it waits until they do.`,
  never: (author) => `${author} answers no questions on their own, so it waits on their word.`,
  "no-conversation": (author) => `No conversation of ${author}'s holds this work, so their AI has nothing to answer from.`,
};

/** What the reader reads of how a forwarded question stands, in the author's name. */
const heardText = (stage: ReviewQuestionStage, author: string, flaw?: string): string => {
  switch (stage) {
    case "waiting":
      return `Waits on ${author}.`;
    case "asking":
      return `${author} is asked whether their AI may answer.`;
    case "answering":
      return `${author}'s AI is reading the conversation the work was done in.`;
    case "answered":
      return "";
    case "declined":
      return `${author} declined to answer.`;
    case "addressing":
      return `${author}'s AI is fixing it${flaw ? `: ${flaw}` : ""}.`;
  }
};

const ASSUMED = "ASSUMED:";
const DRAFT = "DRAFT:";

/** What the reader's AI is told when it answers in the author's place: its
 *  guess in one line collagen reads (and, critiquing, each change it would
 *  ask for, as a draft comment). */
const insteadOf = (mode: "assume" | "critique", author: string): string =>
  [
    `${author} cannot answer this for now. Answer in their place, from the code and the review's why: your best reading of why it is this way — plainly an assumption, never their word.`,
    mode === "critique" ? `Then look at that reason critically: is it a good enough reason? If not, say what should have been done instead.` : "",
    `End with one line: \`${ASSUMED} <the reason you assume, one sentence> || RESTS ON: <what in the code or the why points there> || SURE: high|medium|low\`.`,
    mode === "critique" ? `Then, for each change you would ask ${author} for, one line: \`${DRAFT} <file>:<line> || <nit|suggest|wish|must> || <the comment, a sentence or two, as a colleague would say it>\`.` : "",
  ]
    .filter((part) => part.length > 0)
    .join("\n");

/** An answer in the author's place, read: the words the reader sees, the
 *  guess to put on the author's why, and the draft comments to make. */
export const insteadAnswer = (
  answer: string,
): { readonly answer: string; readonly assumed: { readonly what: string; readonly basis: string; readonly confidence: "high" | "medium" | "low" } | null; readonly drafts: ReadonlyArray<{ readonly file: string; readonly line: number; readonly strength: "nit" | "suggest" | "wish" | "must"; readonly body: string }> } => {
  const kept: Array<string> = [];
  let assumed: { what: string; basis: string; confidence: "high" | "medium" | "low" } | null = null;
  const drafts: Array<{ file: string; line: number; strength: "nit" | "suggest" | "wish" | "must"; body: string }> = [];
  for (const raw of answer.split("\n")) {
    const line = raw.trim().replace(/^`+|`+$/g, "").trim();
    if (line.startsWith(ASSUMED)) {
      const [what, basis, sure] = line.slice(ASSUMED.length).split("||").map((part) => part.trim());
      const confidence = /(high|medium|low)/.exec(sure ?? "")?.[1] as "high" | "medium" | "low" | undefined;
      if (what) assumed = { what, basis: (basis ?? "").replace(/^RESTS ON:\s*/, "") || "the code", confidence: confidence ?? "low" };
      continue;
    }
    if (line.startsWith(DRAFT)) {
      const [where, strength, body] = line.slice(DRAFT.length).split("||").map((part) => part.trim());
      const at = /^(.+):(\d+)$/.exec(where ?? "");
      const level = /(nit|suggest|wish|must)/.exec(strength ?? "")?.[1] as "nit" | "suggest" | "wish" | "must" | undefined;
      if (at && body) drafts.push({ file: at[1]!, line: Number(at[2]), strength: level ?? "suggest", body });
      continue;
    }
    kept.push(raw);
  }
  return { answer: kept.join("\n").trim(), assumed, drafts };
};

/** A turn as kept, and back: what the page shows at once after a restart. */
const kept = (turn: ChatTurn): ChatTurnKept | null =>
  turn.state === "answering"
    ? null
    : {
        id: turn.id,
        question: turn.question,
        ...(turn.selection ? { selection: turn.selection } : {}),
        ...(turn.commit ? { commit: turn.commit } : {}),
        answer: turn.answer,
        state: turn.state,
        ...(turn.error !== undefined ? { error: turn.error } : {}),
        ...(turn.from ? { from: turn.from } : {}),
        ...(turn.forward ? { forward: turn.forward } : {}),
        ...(turn.fallback ? { fallback: true } : {}),
      };
const fromKept = (turn: ChatTurnKept): ChatTurn => ({ ...turn, selection: turn.selection ?? null, commit: turn.commit ?? null, doing: null });

/** A review's earlier turns, read back from the AI's own log of the
 *  conversation: each question collagen sent it (its "Their question:" line,
 *  with the lines selected and the commit the page showed), and the last
 *  thing the AI wrote before the next one. A tool's result, its thinking and
 *  its tool calls are not turns. */
export const turnsFromLog = (lines: ReadonlyArray<TranscriptLine>): ReadonlyArray<ChatTurn> => {
  const turns: Array<ChatTurn> = [];
  for (const line of lines) {
    if (line.who === "user") {
      const at = line.text.lastIndexOf(QUESTION);
      if (at < 0) continue;
      const picked = /They selected (.+?), lines? (\d+)(?:–(\d+))? of the diff:\n```diff\n([\s\S]*?)\n```/.exec(line.text);
      const commit = /(?:at commit|now shows commit) ([0-9a-f]{7,40})/.exec(line.text)?.[1] ?? turns.at(-1)?.commit ?? null;
      const selection: ChatSelection | null = picked
        ? { file: picked[1]!, from: { line: Number(picked[2]), side: "RIGHT" }, to: { line: Number(picked[3] ?? picked[2]), side: "RIGHT" }, text: picked[4]! }
        : null;
      turns.push({ id: `log-${turns.length}`, question: line.text.slice(at + QUESTION.length).trim(), selection, commit, answer: "", doing: null, state: "done" });
    } else if (line.who === "assistant" && turns.length > 0) {
      const text = line.text.trim();
      if (text && !text.startsWith("⚙") && text !== "(thinking)") turns[turns.length - 1] = { ...turns[turns.length - 1]!, answer: text };
    }
  }
  return turns.slice(-KEEP);
};

/** A turn with the answer's events applied: text grows, the final answer replaces it, a failure says why. */
export const applyEvents = (turn: ChatTurn, blocks: Array<string>, events: ReadonlyArray<ChatEvent>): ChatTurn => {
  let doing = turn.doing;
  let error = turn.error;
  for (const event of events) {
    if (event.kind === "text") {
      if (event.block || blocks.length === 0) blocks.push(event.text);
      else blocks[blocks.length - 1] += event.text;
      doing = null;
    } else if (event.kind === "final") {
      if (event.text.trim()) blocks.splice(0, blocks.length, event.text);
      doing = null;
    } else if (event.kind === "doing") doing = event.what;
    else if (event.kind === "failed") error = event.error;
  }
  return { ...turn, answer: blocks.filter((block) => block.trim().length > 0).join("\n\n").trim(), doing, ...(error !== undefined ? { error } : {}) };
};

export class ReviewChat extends Context.Service<ReviewChat>()("cli/ReviewChat", {
  make: Effect.gen(function* () {
    const store = yield* StateStore;
    const adapters = yield* Adapters;
    const harnesses = yield* Harnesses;
    const questions = yield* ReviewQuestions;
    const me = (yield* IdentityService).identity.pubkey;
    // the page's live view reads the room: what it needs, held from here
    const roomContext = yield* Effect.context<Rooms | StateStore>();
    const mcp = yield* McpInfo;
    const { profile } = yield* CliArgs;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const scope = yield* Effect.scope;
    const chats = yield* SubscriptionRef.make<ReadonlyMap<string, Chat>>(new Map());

    const change = (ticketId: string, update: (conversation: Chat) => Chat) =>
      SubscriptionRef.update(chats, (byTicket) => new Map(byTicket).set(ticketId, update(byTicket.get(ticketId) ?? EMPTY)));
    const changeTurn = (ticketId: string, id: string, update: (turn: ChatTurn) => ChatTurn) =>
      change(ticketId, (conversation) => ({ ...conversation, turns: conversation.turns.map((turn) => (turn.id === id ? update(turn) : turn)) }));

    /** Why the reader's AI cannot be asked here, or null. */
    // the reader's AI: a harness, or a mock of one
    const chatOf = (ai: string | null) => (ai === null ? undefined : (adapters[ai]?.chat ?? harnessFor(harnesses, ai)?.chat));
    const cannot = (ai: string | null): string | null => (ai === null ? "No AI to ask yet: collagen asks the one your conversations use most" : chatOf(ai) ? null : `${ai} can't be asked from here`);

    /** One answer: the AI's CLI run on the prompt, its stdout read as it comes. */
    const answer = Effect.fn("ReviewChat.answer")(
      function* (ticketId: string, turnId: string, ai: string, cwd: string, prompt: string, resume: Option.Option<string>) {
        const chat = chatOf(ai)!;
        const context = { cwd, prompt, sessionId: resume, mcpUrl: yield* mcp.awaitUrl, serverName: mcpServerName(profile) };
        const proc = yield* ChildProcess.make(chat.cmd, [...chat.args(context)], { cwd, stdin: "ignore" });
        const blocks: Array<string> = [];
        const stderr: Array<string> = [];
        const errDrain = proc.stderr.pipe(
          Stream.decodeText(),
          Stream.splitLines,
          Stream.runForEach((line) => Effect.sync(() => void stderr.push(line)).pipe(Effect.andThen(Effect.logWarning(`${chat.cmd}: ${line}`)))),
        );
        const out = proc.stdout.pipe(
          Stream.decodeText(),
          Stream.splitLines,
          Stream.map(chat.read),
          Stream.groupedWithin(256, BEAT),
          Stream.runForEach((batch) =>
            Effect.gen(function* () {
              const events = batch.flat();
              for (const event of events)
                if (event.kind === "session") {
                  yield* change(ticketId, (conversation) => ({ ...conversation, session: { ai, id: event.id } }));
                  yield* store.update((state) => ({ ...state, chats: { ...state.chats, [ticketId]: { ...state.chats?.[ticketId], ai, id: event.id } } }));
                }
              yield* changeTurn(ticketId, turnId, (turn) => applyEvents(turn, blocks, events));
            }),
          ),
        );
        yield* Effect.all([out, errDrain], { concurrency: 2 });
        const code = yield* proc.exitCode;
        yield* changeTurn(ticketId, turnId, (turn) =>
          turn.error !== undefined
            ? { ...turn, state: "failed", doing: null }
            : code !== 0 && turn.answer.length === 0
              ? { ...turn, state: "failed", doing: null, error: stderr.filter((line) => line.trim()).slice(-1)[0]?.slice(0, 300) ?? `${chat.cmd} stopped (exit ${code})` }
              : { ...turn, state: "done", doing: null },
        );
        yield* forwarded(ticketId, turnId);
        yield* actedInstead(ticketId, turnId);
        yield* keepTurns(ticketId);
      },
      (effect, ticketId, turnId, ai) =>
        effect.pipe(
          Effect.scoped,
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Effect.catch((error) => changeTurn(ticketId, turnId, (turn) => ({ ...turn, state: "failed", doing: null, error: `couldn't start ${ai}: ${String(error)}`.slice(0, 300) }))),
          Effect.onInterrupt(() => changeTurn(ticketId, turnId, (turn) => ({ ...turn, state: "stopped", doing: null }))),
          Effect.ensuring(change(ticketId, (conversation) => (conversation.running?.turn === turnId ? { ...conversation, running: null } : conversation))),
        ),
    );

    /** Ask the reader's AI about the review — about lines they selected, or
     *  not — at the commit the page shows. Refused while it is still
     *  answering, or when there is no AI to ask. */
    const ask = Effect.fn("ReviewChat.ask")(function* (ticketId: string, question: string, selection: ChatSelection | null, commit: string | null, about?: { readonly questionId: string; readonly mode: "assume" | "critique"; readonly author: string; readonly asked: string }) {
      const ai = shownAi(yield* store.get);
      const no = cannot(ai);
      if (no || ai === null) return { error: no ?? "No AI set in collagen" } satisfies ChatAsked;
      const found = yield* reviewNamed(ticketId);
      if (!found) return { error: `no review ticket ${ticketId} in your rooms` } satisfies ChatAsked;
      yield* recall(ticketId);
      const tree = yield* reviewTree(ticketId);
      const clone = typeof tree !== "string";
      // the page's moment, never the branch's now: a commit the clone lacks is refused
      if (clone && commit !== null && !(yield* commitIn(tree.projectPath, commit))) return { error: `${commit.slice(0, 7)} is not in your clone` } satisfies ChatAsked;
      const turn: ChatTurn = { id: randomUUID(), question, selection, commit, answer: "", doing: null, state: "answering", ...(about ? { about: { questionId: about.questionId, mode: about.mode } } : {}) };
      // checked and taken in one step: two tabs asking at once get one answer under way
      const taken = yield* SubscriptionRef.modify(chats, (byTicket) => {
        const before = byTicket.get(ticketId) ?? EMPTY;
        if (before.turns.some((other) => other.state === "answering")) return [null, byTicket] as const;
        // a conversation is with one AI: another set since starts a new one
        const session = before.session?.ai === ai ? Option.some(before.session.id) : Option.none<string>();
        const next: Chat = { ...before, session: Option.isSome(session) ? before.session : null, turns: [...before.turns, turn].slice(-KEEP) };
        return [{ session, lastCommit: before.turns.at(-1)?.commit ?? null }, new Map(byTicket).set(ticketId, next)] as const;
      });
      if (!taken) return { error: "Still answering" } satisfies ChatAsked;
      const { session, lastCommit } = taken;
      const prompt = promptFor({
        opening: Option.isNone(session)
          ? preamble({ title: found.ticket.title ?? found.ticket.goal, branch: found.review.branch, base: found.review.base, commit, ticketId, serverName: mcpServerName(profile), clone })
          : null,
        moved: clone && commit !== null && commit !== lastCommit ? commit : null,
        now: about ? `${asked(selection, about.asked)}\n\n${insteadOf(about.mode, about.author)}` : asked(selection, question),
      });
      const fiber = yield* answer(ticketId, turn.id, ai, clone ? tree.projectPath : homedir(), prompt, session).pipe(Effect.forkIn(scope));
      // set only while that turn still runs — a quick one may be done already
      yield* change(ticketId, (conversation) => ({ ...conversation, running: conversation.turns.some((listed) => listed.id === turn.id && listed.state === "answering") ? { turn: turn.id, fiber } : conversation.running }));
      return { ok: true } satisfies ChatAsked;
    });

    /** After a restart, a review's conversation as the person's state points
     *  to it: re-entered by the next question, its earlier turns read back
     *  from the AI's own log. Once per review per run. */
    const recalled = new Set<string>();
    const recall = (ticketId: string) =>
      Effect.gen(function* () {
        if (recalled.has(ticketId)) return;
        recalled.add(ticketId);
        if ((yield* SubscriptionRef.get(chats)).has(ticketId)) return;
        const ref = (yield* store.get).chats?.[ticketId];
        if (!ref) return;
        const file = ref.turns ? null : transcriptFile(harnesses, ref.ai, ref.id);
        const turns = ref.turns
          ? ref.turns.map(fromKept)
          : file
          ? yield* Effect.sync(() => {
              try {
                return turnsFromLog(readFileSync(file, "utf8").split("\n").flatMap((raw) => readLine(harnesses, raw) ?? []));
              } catch {
                return [];
              }
            })
          : [];
        yield* SubscriptionRef.update(chats, (byTicket) => (byTicket.has(ticketId) ? byTicket : new Map(byTicket).set(ticketId, { ...EMPTY, turns, session: { ai: ref.ai, id: ref.id } })));
      });

    /** The turns kept with the conversation's place, so the page shows them at once. */
    const keepTurns = (ticketId: string) =>
      Effect.gen(function* () {
        const conversation = (yield* SubscriptionRef.get(chats)).get(ticketId);
        if (!conversation?.session) return;
        const session = conversation.session;
        const turns = conversation.turns.flatMap((turn) => kept(turn) ?? []).slice(-KEEP);
        yield* store.update((state) => ({ ...state, chats: { ...state.chats, [ticketId]: { ai: session.ai, id: session.id, turns } } }));
      });

    /** Hand a question to the review's author's AI: refused for the reader's own review. */
    const askAuthor = (ticketId: string, turn: ChatTurn, question: string) =>
      Effect.gen(function* () {
        const found = yield* reviewNamed(ticketId);
        if (!found) return null;
        const id = randomUUID();
        const said = yield* questions.ask(found.roomId, { id, ticketId, question, ...(turn.selection ? { lines: turn.selection } : {}), ...(turn.commit ? { commit: turn.commit } : {}) });
        return said.startsWith("failed") ? null : id;
      });

    /** An answer that says only the author can tell: offered, asked or left,
     *  as the reader's forwarding steering says. */
    const forwarded = (ticketId: string, turnId: string) =>
      Effect.gen(function* () {
        const turn = (yield* SubscriptionRef.get(chats)).get(ticketId)?.turns.find((each) => each.id === turnId);
        const handed = turn && turn.state === "done" ? forwardOf(turn.answer) : null;
        if (!turn || !handed) return;
        const found = yield* reviewNamed(ticketId);
        const own = !found || found.ticket.createdBy === me;
        const level = levelOf(yield* store.get, "forward", "mine", found?.roomId);
        const auto = !own && (level === "act" || level === "auto");
        const id = auto ? yield* askAuthor(ticketId, turn, handed.question) : null;
        const state = own || level === "never" ? "off" : id ? "asked" : "offered";
        yield* changeTurn(ticketId, turnId, (each) => ({ ...each, answer: handed.answer, forward: { ...(id ? { id } : {}), question: handed.question, state } }));
      });

    /** An answer in the author's place: its guess goes onto their review's
     *  why, its critique becomes the reader's draft comments, and the reader
     *  reads what went where. */
    const actedInstead = (ticketId: string, turnId: string) =>
      Effect.gen(function* () {
        const turn = (yield* SubscriptionRef.get(chats)).get(ticketId)?.turns.find((each) => each.id === turnId);
        if (!turn?.about || turn.state !== "done") return;
        const read = insteadAnswer(turn.answer);
        const found = yield* reviewNamed(ticketId);
        const said: Array<string> = [];
        if (read.assumed && found) {
          const sent = yield* questions.assume(found.roomId, { id: turn.about.questionId, ticketId, ...read.assumed });
          said.push(sent.startsWith("failed") ? `The guess could not be sent: ${sent.replace(/^failed: /, "")}` : `Your AI's guess goes on ${found.review.authorName}'s review's why, for them to confirm, correct or reject.`);
        }
        if (read.drafts.length > 0) {
          const result = yield* draftComments(ticketId, read.drafts.map((draft) => ({ spot: { file: draft.file, line: draft.line, side: "RIGHT" as const }, body: draft.body, strength: draft.strength })));
          said.push("error" in result ? `The comments could not be drafted: ${result.error}` : `${result.drafted.length} draft comment${result.drafted.length === 1 ? "" : "s"} on the page, under the lines they are about: yours to accept, edit or decline.`);
        }
        yield* changeTurn(ticketId, turnId, (each) => ({ ...each, answer: [read.answer, ...said].filter((part) => part.length > 0).join("\n\n") }));
      });

    /** In the author's place: the reader's AI assumes the reason (or assumes
     *  and critiques it), for the question the author could not answer. */
    const instead = Effect.fn("ReviewChat.instead")(function* (ticketId: string, turnId: string, mode: "assume" | "critique") {
      const theirs = (yield* SubscriptionRef.get(chats)).get(ticketId)?.turns.find((each) => each.id === turnId);
      if (!theirs?.from || !theirs.fallback) return { error: "nothing to answer in the author's place there" } satisfies ChatAsked;
      const questionId = theirs.id.replace(/^author-/, "");
      return yield* ask(ticketId, mode === "assume" ? `Assume why: ${theirs.question}` : `Assume why, and critique it: ${theirs.question}`, theirs.selection, theirs.commit, { questionId, mode, author: theirs.from, asked: theirs.question });
    });

    /** The reader's word: ask the author what the why could not say. */
    const forward = Effect.fn("ReviewChat.forward")(function* (ticketId: string, turnId: string) {
      const turn = (yield* SubscriptionRef.get(chats)).get(ticketId)?.turns.find((each) => each.id === turnId);
      if (!turn?.forward || turn.forward.state !== "offered") return { error: "nothing to ask the author there" } satisfies ChatAsked;
      const id = yield* askAuthor(ticketId, turn, turn.forward.question);
      if (!id) return { error: "the question could not be sent" } satisfies ChatAsked;
      yield* changeTurn(ticketId, turnId, (each) => ({ ...each, forward: { id, question: turn.forward!.question, state: "asked" } }));
      yield* keepTurns(ticketId);
      return { ok: true } satisfies ChatAsked;
    });

    // what comes back from the authors: their AI's answer as a turn of its own, under the question it answers
    yield* SubscriptionRef.changes(questions.heard).pipe(
      Stream.mapEffect((all) =>
        Effect.forEach(
          all,
          ({ fromName, answer: back }) =>
            Effect.gen(function* () {
              yield* recall(back.ticketId);
              const conversation = (yield* SubscriptionRef.get(chats)).get(back.ticketId);
              const asked = conversation?.turns.find((turn) => turn.forward?.id === back.id);
              if (!conversation || !asked) return;
              // it cannot be answered for now: said why, and the reader is offered their own AI's reading instead
              const stuck = back.stage === "waiting" && back.why !== undefined;
              const done = back.stage === "answered" || back.stage === "declined" || back.stage === "addressing" || stuck;
              const text = back.stage === "answered" ? `${back.answer ?? ""}${back.flaw ? `\n\nFound wrong: ${back.flaw}` : ""}` : stuck ? CANNOT[back.why!](fromName) : heardText(back.stage, fromName, back.flaw);
              const theirs: ChatTurn = { id: `author-${back.id}`, question: asked.forward!.question, selection: asked.selection, commit: asked.commit, answer: done ? text : "", doing: done ? null : text, state: done ? "done" : "answering", from: fromName, ...(stuck || back.stage === "declined" ? { fallback: true } : {}) };
              const had = conversation.turns.find((turn) => turn.id === theirs.id);
              // an answer once in stays: a later stage (being fixed) is said under it; one that could not be answered yet gives way to the answer
              if (had && had.state === "done" && !had.fallback && back.stage !== "addressing") return;
              const next = had ? { ...theirs, answer: had.state === "done" && back.stage === "addressing" ? `${had.answer}\n\n${text}` : theirs.answer } : theirs;
              yield* change(back.ticketId, (each) => {
                const without = each.turns.filter((turn) => turn.id !== theirs.id);
                const at = without.findIndex((turn) => turn.id === asked.id);
                return { ...each, turns: [...without.slice(0, at + 1), next, ...without.slice(at + 1)] };
              });
              if (done) yield* keepTurns(back.ticketId);
            }),
          { discard: true },
        ),
      ),
      Stream.runDrain,
      Effect.forkScoped,
    );

    /** Stop the answer under way, keeping what it said so far. */
    const stop = Effect.fn("ReviewChat.stop")(function* (ticketId: string) {
      const running = (yield* SubscriptionRef.get(chats)).get(ticketId)?.running;
      if (running) yield* Fiber.interrupt(running.fiber);
    });

    /** A new conversation: the answer under way stopped, the turns gone, the next question starts afresh. */
    const clear = Effect.fn("ReviewChat.clear")(function* (ticketId: string) {
      yield* stop(ticketId);
      yield* SubscriptionRef.update(chats, (byTicket) => {
        const next = new Map(byTicket);
        next.delete(ticketId);
        return next;
      });
      yield* store.update((state) => {
        const { [ticketId]: _gone, ...rest } = state.chats ?? {};
        return { ...state, chats: rest };
      });
    });

    /** The conversation on a review, whole: now, then on every change —
     *  a reconnect starts again from now. */
    const view = (ticketId: string): Stream.Stream<ChatView> =>
      Stream.merge(SubscriptionRef.changes(chats), SubscriptionRef.changes(store.state)).pipe(
        Stream.mapEffect(() =>
          Effect.gen(function* () {
            yield* recall(ticketId);
            const ai = shownAi(yield* store.get);
            const turns = (yield* SubscriptionRef.get(chats)).get(ticketId)?.turns ?? [];
            const found = yield* reviewNamed(ticketId).pipe(Effect.provideContext(roomContext));
            const author = found && found.ticket.createdBy !== me ? found.review.authorName : null;
            return JSON.stringify({ ai, cannot: cannot(ai), author, turns } satisfies ChatView);
          }),
        ),
        Stream.changes,
        Stream.map((json) => JSON.parse(json) as ChatView),
      );

    return { ask, stop, clear, view, forward, instead } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
