import type { JobKind, SteeringKind, TagRoute } from "@collagen/p2p";
import type { SettingKey } from "../../lib/settings";
import type { Cause, SteeringAt } from "../../lib/steering";

/** The settings page's tabs: first the general level every row not set
 *  follows, with the page's own switches; then, by who acts in your name,
 *  your AI, which collagen starts, wakes and hands work to, and tools,
 *  which collagen calls itself with no AI (the repo host now, more to come). */
export type Tab = "ai" | "tools" | "general";
export const TABS: ReadonlyArray<{ readonly id: Tab; readonly label: string }> = [
  { id: "general", label: "General" },
  { id: "ai", label: "AI" },
  { id: "tools", label: "Tools" },
];

/** Which settings a page holds: the room's steering, what S opens in a
 *  room, or the global ones, everything a room takes when it sets nothing. */
export type Scope = "room" | "global";

/** One line on the page. */
export type Row =
  | { readonly id: string; readonly kind: "steer"; readonly at: SteeringAt; readonly cause: Cause }
  | { readonly id: string; readonly kind: "tag" }
  | { readonly id: string; readonly kind: "switch"; readonly key: SettingKey; readonly name?: string; readonly says?: { readonly on: string; readonly off: string } }
  /** a group's name, over the rows that set it */
  | { readonly id: string; readonly kind: "label"; readonly text: string }
  | { readonly id: string; readonly kind: "jobLimit" }
  | { readonly id: string; readonly kind: "harness"; readonly job: JobKind }
  | { readonly id: string; readonly kind: "model"; readonly job: JobKind }
  | { readonly id: string; readonly kind: "merge" }
  | { readonly id: string; readonly kind: "heading"; readonly text: string }
  /** a dim line under a heading: what the rows below are about, in a sentence */
  | { readonly id: string; readonly kind: "note"; readonly text: string; readonly indent?: number }
  /** the column's name, right above the rows that have it */
  | { readonly id: string; readonly kind: "columns" }
  | { readonly id: string; readonly kind: "space" };

/** Each steering row's name, a word or two: the line under the list says the rest. */
export const STEER_WORDS: Record<SteeringAt, string> = {
  master: "general",
  work: "work",
  deliver: "delivery",
  run: "research",
  investigate: "investigations",
  report: "reports",
  host: "repo host",
  close: "closing",
  review: "review asks",
  forward: "forwarding",
  answer: "answers",
  notes: "steering notes",
  guidance: "guidance pass",
  admit: "letting in",
};

/** Whose doing a steering row is about: yours, or another person's. */
export const CAUSE_WORDS: Record<Cause, string> = { mine: "You", others: "Others" };

/** Each job's row name. */
export const JOB_WORDS: Record<JobKind, string> = { wake: "wake-ups", research: "research", investigation: "investigations", filing: "review asks", answering: "answers", chat: "chat", guidance: "guidance pass" };

/** What each kind of run does, a line under its name. */
export const JOB_ABOUT: Record<JobKind, string> = {
  wake: "Wakes the conversation that worked on a ticket when something new comes on it.",
  research: "Looks into a ticket when you ask for more info, and posts what it found.",
  investigation: "Works through an investigation's goals, and posts what it found.",
  filing: "Reads the conversation your work was done in, and files the review someone asked for.",
  answering: "Reads the conversation your work was done in, and answers a question about your review.",
  chat: "Answers what you ask about a review on its page, reading your clone.",
  guidance: "Checks a review you file against the steering notes that apply, before anyone else reads it.",
};

/** Where a message for you goes, short. */
export const TAG_WORDS: Record<TagRoute, string> = {
  none: "your inbox only",
  existing: "the conversation on its ticket",
  "existing-or-new": "that, else a new conversation",
  new: "a new conversation",
};

/** The routes the page offers: starting a new conversation is not built
 *  yet, so only these two do what they say (an agent may still set others). */
export const TAG_CHOICES: ReadonlyArray<TagRoute> = ["existing", "none"];

/** One steering row: a kind, for your own doing or another person's. */
const steer = (at: SteeringAt, cause: Cause): ReadonlyArray<Row> => [{ id: `steer:${at}:${cause}`, kind: "steer", at, cause }];
const both = (at: SteeringAt): ReadonlyArray<Row> => [...steer(at, "mine"), ...steer(at, "others")];
const job = (kind: JobKind): ReadonlyArray<Row> => [
  { id: `label:${kind}`, kind: "label", text: JOB_WORDS[kind] },
  { id: `about:${kind}`, kind: "note", text: JOB_ABOUT[kind], indent: 4 },
  { id: `harness:${kind}`, kind: "harness", job: kind },
  { id: `model:${kind}`, kind: "model", job: kind },
];
/** Single player is your own AIs working for you, on what you or they
 *  started; multiplayer is where another person comes in — their doing, or
 *  an act of yours that reaches them (asking their AI, letting them in). */
const SINGLE: ReadonlyArray<SteeringKind> = ["work", "deliver", "run", "investigate", "report", "close", "answer", "notes", "guidance"];
const MULTI: ReadonlyArray<readonly [SteeringKind, Cause]> = [
  ["work", "others"],
  ["deliver", "others"],
  ["run", "others"],
  ["investigate", "others"],
  ["report", "others"],
  // a review of your work is asked by someone else
  ["review", "others"],
  // your chat asking a review's author's AI
  ["forward", "mine"],
  ["answer", "others"],
  ["notes", "others"],
  // who comes into a room, and who is taken out
  ["admit", "mine"],
];

/** An empty line. Space says what belongs together: a row's lines sit
 *  close, groups of rows a line apart, sections two (skill: alignment). */
let spaces = 0;
const space = (): Row => ({ id: `space:${spaces++}`, kind: "space" });

/** A section: its title, then what it is about, then its groups of rows,
 *  each a line apart from the next. */
const section = (title: string, about: ReadonlyArray<string>, ...groups: ReadonlyArray<ReadonlyArray<Row>>): ReadonlyArray<Row> => [
  { id: `h:${title}`, kind: "heading", text: title },
  ...(about.length > 0 ? [space(), ...about.map((text): Row => ({ id: `n:${title}:${text.slice(0, 12)}`, kind: "note", text }))] : []),
  ...groups.flatMap((group) => [space(), ...group]),
];
/** Sections two lines apart. */
const sections = (...parts: ReadonlyArray<ReadonlyArray<Row>>): ReadonlyArray<Row> => parts.flatMap((part, index) => (index === 0 ? part : [space(), space(), ...part]));
/** The column's name over a group of rows: its own id in each section, a tab holding more than one. */
const columns = (section: string): Row => ({ id: `columns:${section}`, kind: "columns" });

/** The rows of each tab, for a scope: the room's page holds its steering
 *  and auto-merge alone — what a room can set — and the global page
 *  everything, its steering what every room takes until it sets its own. */
const rowsOf = (scope: Scope): Record<Tab, ReadonlyArray<Row>> => ({
  ai: sections(
    section(
      "Single player",
      [
        scope === "room" ? "Your AI acting for you in this room: how far collagen goes with it before asking you." : "Your AI acting for you: how far collagen goes with it before asking you, in every room that sets nothing of its own.",
        "Your own AIs at work: started by you or your AI, like a ticket you filed.",
      ],
      [columns("single"), ...steer(SINGLE[0]!, "mine")],
      ...SINGLE.slice(1).map((kind) => steer(kind, "mine")),
    ),
    section(
      "Multiplayer",
      ["Where someone else comes in: started by them, like their ticket naming you or their message, or reaching them, like asking their AI."],
      [columns("multi"), ...steer(MULTI[0]![0], MULTI[0]![1])],
      ...MULTI.slice(1).map(([kind, cause]) => steer(kind, cause)),
      ...(scope === "global"
        ? [
            [
              { id: "label:tag", kind: "label", text: "messages for you" },
              { id: "about:tag", kind: "note", text: "When a message comes for you: wake the conversation that worked on its ticket, or keep it in your inbox.", indent: 4 },
              { id: "tag", kind: "tag" },
            ] satisfies ReadonlyArray<Row>,
          ]
        : []),
    ),
    ...(scope === "global" ? [section(
      "AI runs",
      ["When collagen runs your AI itself: the harness and model each kind of run uses."],
      [{ id: "jobLimit", kind: "jobLimit" }],
      job("wake"),
      job("research"),
      [...job("investigation"), { id: "switch:investigationsAtOnce", kind: "switch", key: "investigationsAtOnce", name: "  goals", says: { on: "all together", off: "one by one" } }],
      job("filing"),
      job("answering"),
      job("chat"),
      job("guidance"),
    )] : []),
  ),
  tools: sections(
    section(
      "Single player",
      ["What collagen does with your accounts itself, with no AI, like posting a review or merging.", "Your own doing, like your approval."],
      [columns("single"), ...steer("host", "mine")],
      [{ id: "merge", kind: "merge" }],
    ),
    section("Multiplayer", ["A colleague's doing, like their approval merging your pull request."], [columns("multi"), ...steer("host", "others")]),
  ),
  general: sections(
    section(
      "Steering",
      [
        scope === "room" ? "The level every row on AI and Tools follows in this room until you set it." : "The level every row on AI and Tools follows until you set it.",
        "You: what you or your AI started. Others: what someone else started.",
      ],
      [columns("general"), ...both("master")],
    ),
    ...(scope === "global"
      ? [
          section("Reviews", [], [
            { id: "switch:openReviewPage", kind: "switch", key: "openReviewPage" },
            { id: "switch:progressBar", kind: "switch", key: "progressBar" },
          ]),
        ]
      : []),
  ),
});

export const ROWS: Record<Scope, Record<Tab, ReadonlyArray<Row>>> = { room: rowsOf("room"), global: rowsOf("global") };

/** Rows the cursor can rest on. */
export const pickable = (row: Row): boolean => row.kind === "steer" || row.kind === "tag" || row.kind === "switch" || row.kind === "jobLimit" || row.kind === "harness" || row.kind === "model" || row.kind === "merge";
