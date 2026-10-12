import { Effect, SubscriptionRef } from "effect";
import { isClosed, ticketName, type Project, type ReviewComment, type ReviewContext, type Ticket } from "@collagen/p2p";
import type { MergeHistory } from "@collagen/review-web/data";
import { defaultBranchOf, repoWebUrl } from "../lib/gitInfo";
import { reviewedCode, ticketsOfMerges } from "../lib/mergeTickets";
import { IdentityService } from "./Identity";
import { hostOf, type HostMerge } from "./RepoHost";
import { Rooms } from "./Rooms";
import { StateStore } from "./StateStore";

// What was merged into a room's projects: the TUI's merges tab and the
// merge history page (review-web, /merges/<roomId>) read the same.

/** What was merged into one of your projects' default branch, the latest
 *  first, as its host says — or why that cannot be read. */
export type ProjectMerges = { readonly project: string } & (
  | { readonly repo: string; readonly base: string; readonly merges: ReadonlyArray<HostMerge> }
  | { readonly none: string }
);

export const projectMerges = (p: Project): Effect.Effect<ProjectMerges> =>
  Effect.gen(function* () {
    const repo = repoWebUrl(p.path);
    if (!repo) return { project: p.name, none: "no remote" };
    const host = hostOf(repo);
    if (!host) return { project: p.name, none: "host not supported" };
    const base = defaultBranchOf(p.path);
    if (!base) return { project: p.name, none: "no default branch" };
    return yield* host.merges(repo, base).pipe(
      Effect.map((merges): ProjectMerges => ({ project: p.name, repo, base, merges })),
      Effect.catchTags({
        HostCliMissing: () => Effect.succeed({ project: p.name, none: "install gh and run gh auth login" }),
        HostRefused: (e) => Effect.succeed({ project: p.name, none: e.reason }),
      }),
    );
  });

/** A room's projects held here, by name, each with its merges. */
export const roomMerges = (roomId: string) =>
  Effect.gen(function* () {
    const projects = [...((yield* (yield* StateStore).get).rooms[roomId] ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    return yield* Effect.forEach(projects, projectMerges, { concurrency: 4 });
  });

/** A project's merges, each with the tickets it came from — or why its
 *  merges cannot be read. */
export type ProjectTimeline = { readonly project: string } & (
  | { readonly base: string; readonly merges: ReadonlyArray<{ readonly merge: HostMerge; readonly tickets: ReadonlyArray<Ticket> }> }
  | { readonly none: string }
);

/** Each merge read, with the room's tickets it came from that `me` may see
 *  (lib/mergeTickets), in the order they were filed. */
export const timelineOf = (
  read: ReadonlyArray<ProjectMerges>,
  tickets: ReadonlyMap<string, Ticket>,
  reviews: ReadonlyArray<ReviewContext>,
  comments: ReadonlyArray<ReviewComment>,
  me: string,
): ReadonlyArray<ProjectTimeline> =>
  read.map((p) => {
    if ("none" in p) return p;
    const host = hostOf(p.repo);
    const code = host ? reviewedCode(p.project, tickets, reviews, comments, me, host) : [];
    return {
      project: p.project,
      base: p.base,
      merges: ticketsOfMerges(p.merges, code).map(({ merge, tickets: ids }) => ({ merge, tickets: ids.flatMap((id) => tickets.get(id) ?? []) })),
    };
  });

/** The merge history page's data: a room's timeline, named as the TUI
 *  names it. The room is read once the merges are in, so the tickets and
 *  their names are of one moment. Null for a room not open here. */
export const mergeHistory = (roomId: string) =>
  Effect.gen(function* () {
    const rooms = yield* Rooms;
    const handle = (yield* SubscriptionRef.get(rooms.handles)).find((h) => h.id === roomId);
    if (!handle) return null;
    const read = yield* roomMerges(roomId);
    const { room } = handle;
    const me = (yield* IdentityService).identity.pubkey;
    const tickets = yield* SubscriptionRef.get(room.tickets);
    const reviews = yield* SubscriptionRef.get(room.reviews);
    const comments = yield* SubscriptionRef.get(room.comments);
    const peers = yield* SubscriptionRef.get(room.roster);
    const members = yield* SubscriptionRef.get(room.members);
    const name = (yield* SubscriptionRef.get(room.meta)).name;
    const nameFor = (key: string): string =>
      key === me ? "you" : (peers.find((p) => p.key === key)?.name ?? members.find((m) => m.key === key)?.name ?? key.slice(0, 8));
    return {
      room: name,
      readAt: new Date().toISOString(),
      projects: timelineOf(read, tickets, reviews, comments, me).map((p) =>
        "none" in p
          ? p
          : {
              project: p.project,
              base: p.base,
              merges: p.merges.map(({ merge, tickets: from }) => ({
                number: merge.number,
                url: merge.url,
                title: merge.title,
                branch: merge.branch,
                at: merge.at,
                tickets: from.map((t) => ({ id: t.id, name: ticketName(t), author: nameFor(t.createdBy), mine: t.createdBy === me, closed: isClosed(t) })),
              })),
            },
      ),
    } satisfies MergeHistory;
  });
