import { Context, Effect, Layer, Option, Stream, SubscriptionRef } from "effect";
import { epicOf, isClosed, ticketName, visibleTo, type Project, type ReviewComment, type ReviewContext, type Ticket } from "@collagen/p2p";
import type { MergeHistory as MergeHistoryData, MergesShown } from "@collagen/review-web/data";
import { defaultBranchOf, repoWebUrl } from "../lib/gitInfo";
import { latestMerges, type MergesPage } from "../lib/github";
import { lineage, reviewedCode, ticketsOfMerges, whyOpen } from "../lib/mergeTickets";
import { IdentityService } from "./Identity";
import { hostOf, type HostCliMissing, type HostMerge, type HostRefused, type RepoHost } from "./RepoHost";
import { Rooms, type RoomHandle } from "./Rooms";
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
  read.map((project) => {
    if ("none" in project) return project;
    const host = hostOf(project.repo);
    const code = host ? reviewedCode(project.project, tickets, reviews, comments, me, host) : [];
    return {
      project: project.project,
      base: project.base,
      more: project.more,
      merges: ticketsOfMerges(project.merges, code).map(({ merge, tickets: ids }) => ({ merge, tickets: lineage(ids, tickets, me) })),
    };
  });

/** Who a key is in a room, as the TUI names them: "you", a peer's name, a
 *  member's, else the key's start. */
export const namesIn = (room: RoomHandle["room"], me: string) =>
  Effect.gen(function* () {
    const peers = yield* SubscriptionRef.get(room.roster);
    const members = yield* SubscriptionRef.get(room.members);
    return (key: string): string =>
      key === me ? "you" : (peers.find((peer) => peer.key === key)?.name ?? members.find((member) => member.key === key)?.name ?? key.slice(0, 8));
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

    const projectMerges = (project: Project, want: number): Effect.Effect<ProjectMerges> =>
      Effect.gen(function* () {
        const repo = repoWebUrl(project.path);
        if (!repo) return { project: project.name, none: "no remote" };
        const host = hostOf(repo);
        if (!host) return { project: project.name, none: "host not supported" };
        const base = defaultBranchOf(project.path);
        if (!base) return { project: project.name, none: "no default branch" };
        return yield* readTo(`${repo} ${base}`, host, repo, base, want).pipe(
          Effect.map((read): ProjectMerges => ({ project: project.name, repo, base, ...latestMerges(read, want) })),
          Effect.catchTags({
            HostCliMissing: () => Effect.succeed({ project: project.name, none: "install gh and run gh auth login" }),
            HostRefused: (error) => Effect.succeed({ project: project.name, none: error.reason }),
          }),
        );
      });

    /** A room's projects held here, by name, each with its merges. */
    const roomMerges = (roomId: string, shown: Shown) =>
      Effect.gen(function* () {
        const projects = [...((yield* store.get).rooms[roomId] ?? [])].sort((a, b) => a.name.localeCompare(b.name));
        return yield* Effect.forEach(projects, (project) => projectMerges(project, shown[project.name] ?? MERGES_PAGE), { concurrency: 4 });
      });

    const viewOf = (roomId: string) =>
      Effect.suspend(() => {
        const known = views.get(roomId);
        if (known) return Effect.succeed(known);
        return SubscriptionRef.make<View>({ shown: {}, refreshed: 0 }).pipe(Effect.tap((ref) => Effect.sync(() => views.set(roomId, ref))));
      });

    return {
      /** A project's latest `want` merges, read from its host (ask-why). */
      projectMerges,
      /** The merges tab's room: its merges, read again as the reader scrolls
       *  on (more), and from scratch on a refresh — null while it is. */
      view: (roomId: string): Stream.Stream<ReadonlyArray<ProjectMerges> | null> =>
        Stream.unwrap(
          Effect.map(viewOf(roomId), (ref) =>
            SubscriptionRef.changes(ref).pipe(
              Stream.zipWithPrevious,
              Stream.switchMap(([before, current]) => {
                const read = Stream.fromEffect(roomMerges(roomId, current.shown));
                // the tab opened: what was merged since is read too
                if (Option.isNone(before)) return Stream.concat(Stream.succeed(null), Stream.fromEffect(Effect.sync(() => pages.clear())).pipe(Stream.drain, Stream.concat(read)));
                return before.value.refreshed !== current.refreshed ? Stream.concat(Stream.succeed(null), read) : read;
              }),
            ),
          ),
        ),
      /** The reader nears the end of a project's `count` merges: show more. */
      more: (roomId: string, project: string, count: number) =>
        Effect.flatMap(viewOf(roomId), (ref) =>
          SubscriptionRef.updateSome(ref, (current) =>
            (current.shown[project] ?? MERGES_PAGE) < count + MERGES_PAGE ? Option.some({ ...current, shown: { ...current.shown, [project]: count + MERGES_PAGE } }) : Option.none(),
          ),
        ),
      /** Forget what was read, and start the room over from its first page. */
      refresh: (roomId: string) =>
        Effect.flatMap(viewOf(roomId), (ref) =>
          Effect.andThen(
            Effect.sync(() => pages.clear()),
            SubscriptionRef.update(ref, (current) => ({ shown: {}, refreshed: current.refreshed + 1 })),
          ),
        ),
      /** The merge history page's data: a room's timeline, `shown` merges of
       *  each project, named as the TUI names it — from scratch when `fresh`.
       *  The room is read once the merges are in, so the tickets and their
       *  names are of one moment. Null for a room not open here. */
      page: (roomId: string, shown: Shown, fresh: boolean) =>
        Effect.gen(function* () {
          const handle = (yield* SubscriptionRef.get(rooms.handles)).find((candidate) => candidate.id === roomId);
          if (!handle) return null;
          if (fresh) pages.clear();
          const read = yield* roomMerges(roomId, shown);
          const { room } = handle;
          const me = identity.pubkey;
          const tickets = yield* SubscriptionRef.get(room.tickets);
          const reviews = yield* SubscriptionRef.get(room.reviews);
          const why = new Map(reviews.map((review) => [review.ticketId, review] as const));
          const comments = yield* SubscriptionRef.get(room.comments);
          const name = (yield* SubscriptionRef.get(room.meta)).name;
          const nameFor = yield* namesIn(room, me);
          return {
            room: name,
            readAt: new Date().toISOString(),
            projects: timelineOf(read, tickets, reviews, comments, me).map((project) =>
              "none" in project
                ? project
                : {
                    project: project.project,
                    base: project.base,
                    more: project.more,
                    merges: project.merges.map(({ merge, tickets: from }) => ({
                      number: merge.number,
                      url: merge.url,
                      title: merge.title,
                      branch: merge.branch,
                      at: merge.at,
                      epics: [...new Set(from.flatMap((ticket) => epicOf(ticket) ?? []))].flatMap((id) => {
                        const epic = tickets.get(id);
                        return epic && visibleTo(epic, tickets, me) ? [{ id, name: ticketName(epic) }] : [];
                      }),
                      tickets: from.map((ticket) => ({
                        id: ticket.id,
                        name: ticketName(ticket),
                        author: nameFor(ticket.createdBy),
                        mine: ticket.createdBy === me,
                        closed: isClosed(ticket),
                        kind: ticket.kind,
                        decisions: (whyOpen(ticket, me) ? (why.get(ticket.id)?.decisions ?? []) : []).map((decision) => ({
                          title: decision.title ?? decision.what,
                          what: decision.what,
                          ...(decision.userWhy ? { userWhy: decision.userWhy } : {}),
                          ...(decision.agentWhy ? { agentWhy: decision.agentWhy } : {}),
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
