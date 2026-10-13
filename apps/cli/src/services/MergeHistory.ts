import { Context, Effect, Layer, Option, Stream, SubscriptionRef } from "effect";
import { isClosed, ticketName, type Project, type ReviewComment, type ReviewContext, type Ticket } from "@collagen/p2p";
import type { MergeHistory as MergeHistoryData, MergesShown } from "@collagen/review-web/data";
import { defaultBranchOf, repoWebUrl } from "../lib/gitInfo";
import { latestMerges, type MergesPage } from "../lib/github";
import { lineage, reviewedCode, ticketsOfMerges, whyOpen } from "../lib/mergeTickets";
import { IdentityService } from "./Identity";
import { hostOf, type HostCliMissing, type HostMerge, type HostRefused, type RepoHost } from "./RepoHost";
import { Rooms } from "./Rooms";
import { StateStore } from "./StateStore";

// What was merged into a room's projects: the TUI's merges tab and the
// merge history page (review-web, /merges/<roomId>) read the same. Both
// show a page of merges and more as the reader scrolls on; the host's pages
// read so far are kept, so scrolling on reads only the pages past them, and
// a refresh starts over.

/** Merges shown at first, and how many more each time the reader nears the end. */
export const MERGES_PAGE = 50;

/** What was merged into one of your projects' default branch, the latest
 *  first, as its host says, and whether there are more past them — or why
 *  that cannot be read. */
export type ProjectMerges = { readonly project: string } & (
  | { readonly repo: string; readonly base: string; readonly merges: ReadonlyArray<HostMerge>; readonly more: boolean }
  | { readonly none: string }
);

/** How many merges to show of each project, by its name; MERGES_PAGE of one not named. */
export type Shown = MergesShown;

/** The merges tab's room: how many of each project it shows, and how many times it was refreshed. */
interface View {
  readonly shown: Shown;
  readonly refreshed: number;
}

/** A project's merges, each with the tickets it came from — or why its
 *  merges cannot be read. */
export type ProjectTimeline = { readonly project: string } & (
  | { readonly base: string; readonly merges: ReadonlyArray<{ readonly merge: HostMerge; readonly tickets: ReadonlyArray<Ticket> }>; readonly more: boolean }
  | { readonly none: string }
);

/** Each merge read, with the room's tickets it came from that `me` may see
 *  (lib/mergeTickets) and those they grew from, what each grew from first. */
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
      more: p.more,
      merges: ticketsOfMerges(p.merges, code).map(({ merge, tickets: ids }) => ({ merge, tickets: lineage(ids, tickets, me) })),
    };
  });

export class MergeHistory extends Context.Service<MergeHistory>()("cli/MergeHistory", {
  make: Effect.gen(function* () {
    const store = yield* StateStore;
    const rooms = yield* Rooms;
    const { identity } = yield* IdentityService;
    // the host's pages read of each repository's branch, until a refresh
    const pages = new Map<string, ReadonlyArray<MergesPage>>();
    const views = new Map<string, SubscriptionRef.SubscriptionRef<View>>();

    /** The pages of `key` read until its latest `want` merges are certain. */
    const readTo = (key: string, host: RepoHost, repo: string, base: string, want: number): Effect.Effect<ReadonlyArray<MergesPage>, HostCliMissing | HostRefused> =>
      Effect.suspend(() => {
        const read = pages.get(key) ?? [];
        if (read.length > 0 && latestMerges(read, want).done) return Effect.succeed(read);
        return host.mergesPage(repo, base, read.at(-1)?.next ?? null).pipe(
          Effect.tap((page) => Effect.sync(() => pages.set(key, [...read, page]))),
          Effect.flatMap(() => readTo(key, host, repo, base, want)),
        );
      });

    const projectMerges = (p: Project, want: number): Effect.Effect<ProjectMerges> =>
      Effect.gen(function* () {
        const repo = repoWebUrl(p.path);
        if (!repo) return { project: p.name, none: "no remote" };
        const host = hostOf(repo);
        if (!host) return { project: p.name, none: "host not supported" };
        const base = defaultBranchOf(p.path);
        if (!base) return { project: p.name, none: "no default branch" };
        return yield* readTo(`${repo} ${base}`, host, repo, base, want).pipe(
          Effect.map((read): ProjectMerges => ({ project: p.name, repo, base, ...latestMerges(read, want) })),
          Effect.catchTags({
            HostCliMissing: () => Effect.succeed({ project: p.name, none: "install gh and run gh auth login" }),
            HostRefused: (e) => Effect.succeed({ project: p.name, none: e.reason }),
          }),
        );
      });

    /** A room's projects held here, by name, each with its merges. */
    const roomMerges = (roomId: string, shown: Shown) =>
      Effect.gen(function* () {
        const projects = [...((yield* store.get).rooms[roomId] ?? [])].sort((a, b) => a.name.localeCompare(b.name));
        return yield* Effect.forEach(projects, (p) => projectMerges(p, shown[p.name] ?? MERGES_PAGE), { concurrency: 4 });
      });

    const viewOf = (roomId: string) =>
      Effect.suspend(() => {
        const known = views.get(roomId);
        if (known) return Effect.succeed(known);
        return SubscriptionRef.make<View>({ shown: {}, refreshed: 0 }).pipe(Effect.tap((ref) => Effect.sync(() => views.set(roomId, ref))));
      });

    return {
      /** The merges tab's room: its merges, read again as the reader scrolls
       *  on (more), and from scratch on a refresh — null while it is. */
      view: (roomId: string): Stream.Stream<ReadonlyArray<ProjectMerges> | null> =>
        Stream.unwrap(
          Effect.map(viewOf(roomId), (ref) =>
            SubscriptionRef.changes(ref).pipe(
              Stream.zipWithPrevious,
              Stream.switchMap(([before, v]) => {
                const read = Stream.fromEffect(roomMerges(roomId, v.shown));
                // the tab opened: what was merged since is read too
                if (Option.isNone(before)) return Stream.concat(Stream.succeed(null), Stream.fromEffect(Effect.sync(() => pages.clear())).pipe(Stream.drain, Stream.concat(read)));
                return before.value.refreshed !== v.refreshed ? Stream.concat(Stream.succeed(null), read) : read;
              }),
            ),
          ),
        ),
      /** The reader nears the end of a project's `count` merges: show more. */
      more: (roomId: string, project: string, count: number) =>
        Effect.flatMap(viewOf(roomId), (ref) =>
          SubscriptionRef.updateSome(ref, (v) =>
            (v.shown[project] ?? MERGES_PAGE) < count + MERGES_PAGE ? Option.some({ ...v, shown: { ...v.shown, [project]: count + MERGES_PAGE } }) : Option.none(),
          ),
        ),
      /** Forget what was read, and start the room over from its first page. */
      refresh: (roomId: string) =>
        Effect.flatMap(viewOf(roomId), (ref) =>
          Effect.andThen(
            Effect.sync(() => pages.clear()),
            SubscriptionRef.update(ref, (v) => ({ shown: {}, refreshed: v.refreshed + 1 })),
          ),
        ),
      /** The merge history page's data: a room's timeline, `shown` merges of
       *  each project, named as the TUI names it — from scratch when `fresh`.
       *  The room is read once the merges are in, so the tickets and their
       *  names are of one moment. Null for a room not open here. */
      page: (roomId: string, shown: Shown, fresh: boolean) =>
        Effect.gen(function* () {
          const handle = (yield* SubscriptionRef.get(rooms.handles)).find((h) => h.id === roomId);
          if (!handle) return null;
          if (fresh) pages.clear();
          const read = yield* roomMerges(roomId, shown);
          const { room } = handle;
          const me = identity.pubkey;
          const tickets = yield* SubscriptionRef.get(room.tickets);
          const reviews = yield* SubscriptionRef.get(room.reviews);
          const why = new Map(reviews.map((r) => [r.ticketId, r] as const));
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
                    more: p.more,
                    merges: p.merges.map(({ merge, tickets: from }) => ({
                      number: merge.number,
                      url: merge.url,
                      title: merge.title,
                      branch: merge.branch,
                      at: merge.at,
                      tickets: from.map((t) => ({
                        id: t.id,
                        name: ticketName(t),
                        author: nameFor(t.createdBy),
                        mine: t.createdBy === me,
                        closed: isClosed(t),
                        kind: t.kind,
                        decisions: (whyOpen(t, me) ? (why.get(t.id)?.decisions ?? []) : []).map((d) => ({
                          title: d.title ?? d.what,
                          what: d.what,
                          ...(d.userWhy ? { userWhy: d.userWhy } : {}),
                          ...(d.agentWhy ? { agentWhy: d.agentWhy } : {}),
                        })),
                      })),
                    })),
                  },
            ),
          } satisfies MergeHistoryData;
        }),
    };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
