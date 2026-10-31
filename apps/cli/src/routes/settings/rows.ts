import type { JobKind, SteeringKind, TagRoute } from "@collagen/p2p";
import type { SettingKey } from "../../lib/settings";
import type { Cause, SteeringAt } from "../../lib/steering";

/** The settings page's tabs, by who acts in your name: your AI, which
 *  collagen starts, wakes and hands work to; tools, which collagen calls
 *  itself with no AI (the repo host now, more to come); and the general
 *  level every row not set follows, with the page's own switches. */
export type Tab = "ai" | "tools" | "general";
export const TABS: ReadonlyArray<{ readonly id: Tab; readonly label: string }> = [
  { id: "ai", label: "AI" },
  { id: "tools", label: "Tools" },
  { id: "general", label: "General" },
];

/** One line on the page. Steering and merging have two columns —
 *  everywhere, and this room — the rest one. */
export type Row =
  | { readonly id: string; readonly kind: "steer"; readonly at: SteeringAt; readonly cause: Cause }
  | { readonly id: string; readonly kind: "tag" }
  | { readonly id: string; readonly kind: "switch"; readonly key: SettingKey }
  | { readonly id: string; readonly kind: "jobLimit" }
  | { readonly id: string; readonly kind: "harness"; readonly job: JobKind }
  | { readonly id: string; readonly kind: "model"; readonly job: JobKind }
  | { readonly id: string; readonly kind: "merge" }
  | { readonly id: string; readonly kind: "heading"; readonly text: string }
  /** a dim line under a heading: what the rows below are about, in a sentence */
  | { readonly id: string; readonly kind: "note"; readonly text: string }
  /** the two columns' names, right above the rows that have them */
  | { readonly id: string; readonly kind: "columns" };

/** Each steering row's name, a word or two: the line under the list says the rest. */
export const STEER_WORDS: Record<SteeringAt, string> = {
  master: "general",
  work: "work",
  deliver: "delivery",
  run: "research",
  investigate: "investigations",
  report: "reports",
  host: "repo host",
};

/** Whose doing a steering row is about: yours, or another person's. */
export const CAUSE_WORDS: Record<Cause, string> = { mine: "you", others: "others" };

/** Each job's row name. */
export const JOB_WORDS: Record<JobKind, string> = { wake: "wake-ups", research: "research", investigation: "investigations" };

/** Where a message for you goes, short. */
export const TAG_WORDS: Record<TagRoute, string> = {
  none: "nowhere",
  existing: "its conversation",
  "existing-or-new": "its conversation, else a new one",
  new: "a new conversation",
};

const steer = (at: SteeringAt): ReadonlyArray<Row> => [
  { id: `steer:${at}:mine`, kind: "steer", at, cause: "mine" },
  { id: `steer:${at}:others`, kind: "steer", at, cause: "others" },
];
const job = (kind: JobKind): ReadonlyArray<Row> => [
  { id: `harness:${kind}`, kind: "harness", job: kind },
  { id: `model:${kind}`, kind: "model", job: kind },
];
const AI_KINDS: ReadonlyArray<SteeringKind> = ["work", "deliver", "run", "investigate", "report"];

export const ROWS: Record<Tab, ReadonlyArray<Row>> = {
  ai: [
    { id: "h:steer", kind: "heading", text: "steering: your AI acts for you" },
    { id: "n:steer", kind: "note", text: "How far collagen goes with your AI before asking you." },
    { id: "n:you", kind: "note", text: "you: you or your AI started it, like a ticket you filed." },
    { id: "n:others", kind: "note", text: "others: someone else did, like their ticket naming you, or their message." },
    { id: "columns", kind: "columns" },
    ...AI_KINDS.flatMap(steer),
    { id: "tag", kind: "tag" },
    { id: "h:jobs", kind: "heading", text: "AI runs" },
    { id: "n:jobs", kind: "note", text: "When collagen runs your AI itself: which AI and model each run uses, and how many at once." },
    { id: "jobLimit", kind: "jobLimit" },
    ...job("wake"),
    ...job("research"),
    ...job("investigation"),
    { id: "switch:investigationsAtOnce", kind: "switch", key: "investigationsAtOnce" },
  ],
  tools: [
    { id: "h:steer", kind: "heading", text: "steering: tools act for you, no AI" },
    { id: "n:steer", kind: "note", text: "What collagen does with your accounts on its own, like posting a review or merging." },
    { id: "n:you", kind: "note", text: "you: your own doing, like your approval." },
    { id: "n:others", kind: "note", text: "others: a colleague's, like their approval merging your pull request." },
    { id: "columns", kind: "columns" },
    ...steer("host"),
    { id: "merge", kind: "merge" },
  ],
  general: [
    { id: "h:steer", kind: "heading", text: "steering: anything not set" },
    { id: "n:steer", kind: "note", text: "The level every row on AI and Tools follows until you set it." },
    { id: "columns", kind: "columns" },
    ...steer("master"),
    { id: "h:reviews", kind: "heading", text: "reviews" },
    { id: "switch:openReviewPage", kind: "switch", key: "openReviewPage" },
    { id: "switch:progressBar", kind: "switch", key: "progressBar" },
    { id: "h:tickets", kind: "heading", text: "tickets" },
    { id: "switch:alsoCloseParents", kind: "switch", key: "alsoCloseParents" },
  ],
};

/** Rows with an everywhere and a this-room column. */
export const twoColumns = (row: Row): boolean => row.kind === "steer" || row.kind === "merge";
/** Rows the cursor can rest on. */
export const pickable = (row: Row): boolean => row.kind === "steer" || row.kind === "tag" || row.kind === "switch" || row.kind === "jobLimit" || row.kind === "harness" || row.kind === "model" || row.kind === "merge";
