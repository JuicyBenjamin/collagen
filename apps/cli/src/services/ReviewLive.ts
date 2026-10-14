import { createHash } from "node:crypto";
import { Context, Effect, Layer, Option, Stream, SubscriptionRef } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { focusTab } from "../lib/focusTab";
import { openerOverride, openInBrowser } from "../lib/opener";
import { settingOf } from "../lib/settings";
import { McpInfo } from "./McpInfo";
import { StateStore } from "./StateStore";
import { Rooms } from "./Rooms";
import { commitOf, reviewTree } from "./ReviewView";

// The review page, kept current and known about. Each open page holds a
// live server function (review-web src/api.ts, reviewChanges) on the
// instance; its token moves when the review's why is revised (the author's agent amends it whenever the code
// moves), when the ticket moves, or when the branch's commit in the
// reader's clone changes — and the page reloads its data in place. The same
// streams tell the instance which reviews have a page open, so `o` (and
// the agent's open-review) can bring that tab forward instead of opening
// another.

export class ReviewPages extends Context.Service<ReviewPages>()("cli/ReviewPages", {
  make: Effect.gen(function* () {
    const mcp = yield* McpInfo;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const store = yield* StateStore;
    const open = new Map<string, number>();
    // reviews whose page this process opened on its own: once each, so a
    // reader who closed it is not handed it again on every read of the why
    const started = new Set<string>();
    const isOpen = (id: string): boolean => (open.get(id) ?? 0) > 0;

    /** Open a review's page — the diff read by intent — in the person's
     *  browser: an open one brought forward where the platform allows,
     *  otherwise a new tab (marked to take over from an open one, which
     *  hands it the reader's place). Says what happened, url included, for a
     *  machine with no browser to open. */
    /** One of this instance's pages: /review/<ticketId> or /merges/<roomId>. */
    const pageUrl = (page: "review" | "merges", id: string) =>
      Effect.map(mcp.awaitUrl, (mcpUrl) => `${mcpUrl.replace(/\/mcp$/, "")}/${page}/${encodeURIComponent(id)}`);
    const launch = (url: string) => openInBrowser(url).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));
    const show = Effect.fn("ReviewPages.show")(function* (ticketId: string) {
      const url = yield* pageUrl("review", ticketId);
      const already = isOpen(ticketId);
      if (already && Option.isNone(yield* openerOverride) && (yield* Effect.promise(() => focusTab(url)))) return `review page brought forward: ${url}`;
      return (yield* launch(already ? `${url}?take` : url)) ? `review page opened: ${url}` : `review page: ${url} (could not open a browser — paste it into one)`;
    });

    return {
      opened: (id: string) => open.set(id, (open.get(id) ?? 0) + 1),
      closed: (id: string) => {
        const count = (open.get(id) ?? 1) - 1;
        if (count > 0) open.set(id, count);
        else open.delete(id);
      },
      /** Is a page for this review open in a browser right now? */
      isOpen,
      show,
      /** Open a room's merge history page (review-web, /merges/<roomId>) in
       *  the person's browser — at one merge of a project, its decisions
       *  open, when `at` names it. Says what happened, url included. */
      showMerges: Effect.fn("ReviewPages.showMerges")(function* (roomId: string, at?: { readonly project: string; readonly number: number }) {
        const url = `${yield* pageUrl("merges", roomId)}${at ? `#${encodeURIComponent(at.project)}/${at.number}` : ""}`;
        return (yield* launch(url)) ? `merges page opened: ${url}` : `merges page: ${url} (could not open a browser — paste it into one)`;
      }),
      /** The person's agent has started on a review: its page opens, unless
       *  they switched that off, it is open already, or it opened once
       *  before in this run. Null when nothing was opened. */
      started: Effect.fn("ReviewPages.started")(function* (ticketId: string) {
        if (!settingOf(yield* store.get, "openReviewPage") || started.has(ticketId) || isOpen(ticketId)) return null;
        started.add(ticketId);
        return yield* show(ticketId);
      }),
    } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}

/** How often the branch's commit is looked at while a page is open: a local
 *  `git rev-parse`, no network. */
const COMMIT_EVERY = "4 seconds";

/** The review's state as a token for an open page — the why's revision,
 *  the ticket as it stands, the branch's commit in the reader's clone, the
 *  comments drafted and said on it —
 *  current first, then each time it moves. While it is read, the review
 *  counts as having a page open (so `o` brings that tab forward). */
export const reviewChanges = (ticketId: string): Stream.Stream<string, never, Rooms | ReviewPages | StateStore> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const rooms = yield* Rooms;
      const pages = yield* ReviewPages;
      const handles = yield* SubscriptionRef.get(rooms.handles);
      let handle: (typeof handles)[number] | undefined;
      for (const candidate of handles) if ((yield* SubscriptionRef.get(candidate.room.tickets)).has(ticketId)) handle = candidate;
      if (!handle) return Stream.empty;
      const { room } = handle;
      const tree = yield* reviewTree(ticketId);
      const store = yield* StateStore;
      const token = Effect.gen(function* () {
        const why = (yield* SubscriptionRef.get(room.reviews)).find((review) => review.ticketId === ticketId)?.ts ?? 0;
        const ticket = createHash("sha1").update(JSON.stringify((yield* SubscriptionRef.get(room.tickets)).get(ticketId) ?? null)).digest("hex");
        const commit = typeof tree === "string" || !tree.ref ? "" : ((yield* commitOf(tree.projectPath, tree.ref)) ?? "");
        // the comments on it: the drafts waiting here, and what the room said
        const drafts = (yield* store.get).drafts?.[ticketId] ?? [];
        const said = (yield* SubscriptionRef.get(room.comments)).filter((comment) => comment.ticketId === ticketId);
        const talk = createHash("sha1").update(JSON.stringify([drafts.map((draft) => draft.id), said.map((comment) => comment.id)])).digest("hex");
        return `${why}|${commit}|${ticket}|${talk}`;
      });
      // anything that might have moved it, then the token as it is now —
      // the same token twice says nothing
      const moved: Array<Stream.Stream<unknown>> = [
        SubscriptionRef.changes(room.reviews),
        SubscriptionRef.changes(room.tickets),
        SubscriptionRef.changes(room.comments),
        SubscriptionRef.changes(store.state),
        ...(typeof tree === "string" || !tree.ref ? [] : [Stream.tick(COMMIT_EVERY)]),
      ];
      pages.opened(ticketId);
      return Stream.mergeAll(moved, { concurrency: "unbounded" }).pipe(
        Stream.mapEffect(() => token),
        Stream.changes,
        Stream.ensuring(Effect.sync(() => pages.closed(ticketId))),
      );
    }),
  );
