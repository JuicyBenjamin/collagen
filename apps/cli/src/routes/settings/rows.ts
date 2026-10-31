import type { JobKind, SteeringKind, TagRoute } from "@collagen/p2p";
import type { SettingKey } from "../../lib/settings";
import type { Cause, SteeringAt } from "../../lib/steering";

/** The settings page's tabs: what collagen and your AI do, what goes on the
 *  repo host in your name, and the general level the rest follow. */
export type Tab = "ai" | "host" | "general";
export const TABS: ReadonlyArray<{ readonly id: Tab; readonly label: string }> = [
  { id: "ai", label: "AI" },
  { id: "host", label: "Repo host" },
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
  | { readonly id: string; readonly kind: "heading"; readonly text: string };

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
    { id: "h:steer", kind: "heading", text: "steering" },
    ...AI_KINDS.flatMap(steer),
    { id: "tag", kind: "tag" },
    { id: "h:jobs", kind: "heading", text: "jobs" },
    { id: "jobLimit", kind: "jobLimit" },
    ...job("wake"),
    ...job("research"),
    ...job("investigation"),
    { id: "switch:investigationsAtOnce", kind: "switch", key: "investigationsAtOnce" },
  ],
  host: [
    { id: "h:steer", kind: "heading", text: "steering" },
    ...steer("host"),
    { id: "merge", kind: "merge" },
    { id: "h:switches", kind: "heading", text: "reviews" },
    { id: "switch:openReviewPage", kind: "switch", key: "openReviewPage" },
    { id: "switch:progressBar", kind: "switch", key: "progressBar" },
  ],
  general: [
    { id: "h:steer", kind: "heading", text: "steering" },
    ...steer("master"),
    { id: "h:switches", kind: "heading", text: "tickets" },
    { id: "switch:alsoCloseParents", kind: "switch", key: "alsoCloseParents" },
  ],
};

/** Rows with an everywhere and a this-room column. */
export const twoColumns = (row: Row): boolean => row.kind === "steer" || row.kind === "merge";
/** Rows the cursor can rest on. */
export const pickable = (row: Row): boolean => row.kind !== "heading";
