import { existsSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { Effect, SubscriptionRef } from "effect";
import { encode as toToon } from "@toon-format/toon";
import type { HostMerge } from "./RepoHost";
import { mergeOn, mergesTouching, whyRows } from "../lib/askWhy";
import { firstRef, run } from "../lib/gitRun";
import { whyOpen } from "../lib/mergeTickets";
import { projectKey } from "../lib/projects";
import { IdentityService } from "./Identity";
import { MergeHistory, namesIn, timelineOf } from "./MergeHistory";
import { Rooms } from "./Rooms";
import { StateStore } from "./StateStore";

// The ask-why tool: from a line, a file or a merge back to the merges that
// made the code what it is, and the why on the tickets they came from.

/** What is asked about: a pull request merged, or a file — and a line of it. */
export interface WhyQuery {
  readonly project?: string;
  readonly file?: string;
  readonly line?: number;
  readonly pull?: number;
  readonly limit?: number;
}

/** How many merges are read from the host, the latest first. */
const MERGES_READ = 100;
/** How far back a branch's history is walked. */
const HISTORY = 20_000;

const lines = (out: string | null): ReadonlyArray<string> =>
  (out ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

/** The why behind some code, for an agent: the merges asked about (or that
 *  last changed a line, or touched a file), the tickets they came from, and
 *  a few of each ticket's decisions and forks. Text, or `failed: …`. */
export const askWhy = (roomId: string, query: WhyQuery) =>
  Effect.gen(function* () {
    if (query.file === undefined && query.pull === undefined)
      return "failed: name a file (and a line), or a pull request";
    if (query.line !== undefined && query.file === undefined) return "failed: a line needs its file";
    const handle = (yield* SubscriptionRef.get((yield* Rooms).handles)).find(
      (live) => live.id === roomId,
    );
    if (!handle) return "failed: that room is gone";
    const projects = (yield* (yield* StateStore).get).rooms[roomId] ?? [];
    const names = projects.map((held) => held.name).join(", ") || "none";
    const abs = query.file !== undefined && isAbsolute(query.file) ? resolve(query.file) : undefined;
    const project = query.project
      ? projects.find((held) => projectKey(held.name) === projectKey(query.project!))
      : abs
        ? projects
            .filter((held) => !relative(resolve(held.path), abs).startsWith(".."))
            .sort((a, b) => b.path.length - a.path.length)[0]
        : projects.length === 1
          ? projects[0]
          : undefined;
    if (!project)
      return query.project
        ? `failed: no project "${query.project}" held here — ${names}`
        : abs
          ? `failed: ${query.file} is in none of this room's projects held here — ${names}`
          : `failed: say which project — ${names}`;

    const read = yield* (yield* MergeHistory).projectMerges(project, MERGES_READ);
    if ("none" in read) return `failed: ${project.name}: ${read.none}`;
    const merges = read.merges;
    const limit = Math.min(10, Math.max(1, Math.floor(query.limit ?? 3)));

    // the file, where git reads it: its own folder, so a worktree's copy is
    // read as it is there
    const path = query.file !== undefined ? (abs ?? join(project.path, query.file)) : undefined;
    const cwd = path ? dirname(path) : project.path;
    if (!existsSync(cwd)) return `failed: no folder ${cwd}`;
    const file = path ? basename(path) : undefined;
    const inRepo = path
      ? `${(yield* run("git", ["rev-parse", "--show-prefix"], cwd, 5_000))?.trim() ?? ""}${file}`
      : undefined;

    let picked: ReadonlyArray<HostMerge>;
    let asked: Record<string, string>;
    if (query.pull !== undefined) {
      picked = merges.filter((merge) => merge.number === query.pull);
      if (picked.length === 0)
        return `failed: #${query.pull} is not among the last ${merges.length} merges into ${read.base}`;
      asked = { asked: `#${query.pull}` };
    } else {
      const base = yield* firstRef(cwd, [`origin/${read.base}`, read.base]);
      if (!base) return `failed: ${read.base} is not in the clone at ${project.path} — fetch it`;
      const history = lines(
        yield* run("git", ["rev-list", "--first-parent", "-n", String(HISTORY), base], cwd, 20_000),
      );
      if (query.line !== undefined) {
        const blame = yield* run(
          "git",
          ["blame", "--porcelain", "-L", `${query.line},${query.line}`, "--", file!],
          cwd,
          20_000,
        );
        const commit = blame?.match(/^([0-9a-f]{40}) /)?.[1];
        if (!commit)
          return `failed: git cannot blame ${inRepo}:${query.line} — no such line, or the file is not tracked`;
        if (/^0+$/.test(commit)) return `${inRepo}:${query.line} is not committed yet: no merge has it`;
        const at = { asked: `${inRepo}:${query.line}`, commit: commit.slice(0, 12) };
        // inside a merged branch, it landed with the first commit on the
        // history to hold it — not any later merge, which holds it too
        const landedAt = history.includes(commit)
          ? commit
          : lines(
              yield* run(
                "git",
                ["rev-list", "--first-parent", "--ancestry-path", `${commit}..${base}`],
                cwd,
                20_000,
              ),
            ).at(-1);
        if (!landedAt) return toToon({ ...at, merge: `not merged into ${read.base} yet` });
        const landed = mergeOn(history, merges, landedAt);
        if (!landed)
          return toToon({
            ...at,
            merge: `none of the last ${merges.length} merges into ${read.base} — older, or pushed without a pull request`,
          });
        picked = [landed];
        asked = at;
      } else {
        const touched = lines(
          yield* run(
            "git",
            ["log", "--first-parent", "--format=%H", "-n", "500", base, "--", file!],
            cwd,
            20_000,
          ),
        );
        picked = mergesTouching(history, merges, touched).slice(0, limit);
        if (picked.length === 0)
          return `no merge of the last ${merges.length} into ${read.base} changed ${inRepo}`;
        asked = { asked: inRepo! };
      }
    }

    // the room, read once the merges and the history are in: one moment
    const { room } = handle;
    const me = (yield* IdentityService).identity.pubkey;
    const tickets = yield* SubscriptionRef.get(room.tickets);
    const reviews = yield* SubscriptionRef.get(room.reviews);
    const comments = yield* SubscriptionRef.get(room.comments);
    const nameFor = yield* namesIn(room, me);
    // tied against every merge read: a branch's ticket goes to its first merge after it was filed
    const timeline = timelineOf(read, tickets, reviews, comments, me);
    const from = new Map(
      "merges" in timeline
        ? timeline.merges.map((entry) => [entry.merge.number, entry.tickets] as const)
        : [],
    );
    const rows = whyRows(
      picked.map((merge) => ({ merge, tickets: from.get(merge.number) ?? [] })),
      // someone else's plan, proposal or bug keeps its why until the reader's own take
      new Map(
        reviews.flatMap((review) => {
          const ticket = tickets.get(review.ticketId);
          return ticket && whyOpen(ticket, me) ? [[review.ticketId, review] as const] : [];
        }),
      ),
      inRepo,
      nameFor,
    );
    const more = rows.tickets.some((row) => row.more.length > 0)
      ? "\n\nThe rest of a ticket's why: review-context {ticketId}."
      : "";
    const none =
      rows.tickets.length === 0
        ? "\n\nNo ticket is tied to these merges: there is no recorded why. Read the pull request instead."
        : "";
    return toToon({ ...asked, project: project.name, ...rows }) + more + none;
  });
