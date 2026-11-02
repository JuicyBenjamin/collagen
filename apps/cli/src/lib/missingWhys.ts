import type { Hunk } from "@collagen/review-web/data";
import { groupByUnit } from "./units";

// What a review's why is missing, as its page shows it: decisions that say
// what was done and give no reason, and changes no decision covers ("Not
// explained"). Asked for the missing whys, the author's collagen hands these
// to their AI one by one, and each answer goes where its gap is (cli
// ReviewQuestions). Pure.

/** One gap: a decision with no reason, or changes no decision covers, by where they are. */
export type MissingWhy = { readonly decision: string; readonly title: string } | { readonly where: string };

/** Every gap in a review's why, decisions first, then the changes in diff order. */
export const missingWhys = (review: Parameters<typeof groupByUnit>[0], hunks: ReadonlyArray<Hunk>): ReadonlyArray<MissingWhy> => {
  const bare = review.decisions.filter((decision) => !decision.userWhy?.trim() && !decision.agentWhy?.trim()).map((decision) => ({ decision: decision.id, title: decision.title ?? decision.what }));
  const unexplained = new Set(groupByUnit(review, hunks, new Map()).units.find((unit) => unit.by === "unexplained")?.hunks ?? []);
  const changes = hunks.filter((hunk) => unexplained.has(hunk.id)).map((hunk) => ({ where: hunk.newLines > 1 ? `${hunk.file}:${hunk.newStart}-${hunk.newStart + hunk.newLines - 1}` : `${hunk.file}:${hunk.newStart}` }));
  return [...bare, ...changes];
};
