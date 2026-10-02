import { execFile } from "node:child_process";
import { Context, Effect, Layer, Stream, SubscriptionRef } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { focusTab } from "../lib/focusTab";
import { settingOf } from "../lib/settings";
import { McpInfo } from "./McpInfo";
import { StateStore } from "./StateStore";
import { Rooms } from "./Rooms";
import { commitOf, localHost, reviewTree, ticketIdOk } from "./ReviewView";

// The review page, kept current and known about. Each open page holds an
// event stream to the instance; the instance says "changed" when the
// review's why is revised (the author's agent amends it whenever the code
// moves), when the ticket moves, or when the branch's commit in the
// reader's clone changes — and the page reloads its data in place. The same
// streams tell the instance which reviews have a page open, so `o` (and
// the agent's open-review) can bring that tab forward instead of opening
// another.

/** The browser's own opener for this platform — or COLLAGEN_OPENER, a
 *  program handed the url instead (a browser of the person's choosing, or a
 *  test that must never open one). */
const opener = (url: string): readonly [string, ReadonlyArray<string>] =>
  process.env.COLLAGEN_OPENER
    ? [process.env.COLLAGEN_OPENER, [url]]
    : process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];

export class ReviewPages extends Context.Service<ReviewPages>()("cli/ReviewPages", {
  make: Effect.gen(function* () {
    const mcp = yield* McpInfo;
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
    const show = Effect.fn("ReviewPages.show")(function* (ticketId: string) {
      const url = `${(yield* mcp.awaitUrl).replace(/\/mcp$/, "")}/review/${encodeURIComponent(ticketId)}`;
      const already = isOpen(ticketId);
      if (already && !process.env.COLLAGEN_OPENER && (yield* Effect.promise(() => focusTab(url)))) return `review page brought forward: ${url}`;
      const [cmd, args] = opener(already ? `${url}?take` : url);
      const ok = yield* Effect.callback<boolean>((resume) => {
        execFile(cmd, [...args], (err) => resume(Effect.succeed(err === null)));
      });
      return ok ? `review page opened: ${url}` : `review page: ${url} (could not open a browser — paste it into one)`;
    });

    return {
      opened: (id: string) => open.set(id, (open.get(id) ?? 0) + 1),
      closed: (id: string) => {
        const n = (open.get(id) ?? 1) - 1;
        if (n > 0) open.set(id, n);
        else open.delete(id);
      },
      /** Is a page for this review open in a browser right now? */
      isOpen,
      show,
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
const KEEP_ALIVE = "20 seconds";

/** Something in this stream changed: emit once per change after the first
 *  value (the page already has that one). */
const afterFirst = <A>(s: Stream.Stream<A>): Stream.Stream<void> => s.pipe(Stream.changes, Stream.drop(1), Stream.map(() => undefined));

export const ReviewLiveRoutes = HttpRouter.add("GET", "/review/:ticketId/events", (request) =>
  Effect.gen(function* () {
    if (!localHost(request.headers["host"])) return HttpServerResponse.text("forbidden", { status: 403 });
    const { ticketId } = yield* HttpRouter.params;
    if (!ticketIdOk(ticketId)) return HttpServerResponse.text("no ticket", { status: 404 });
    const rooms = yield* Rooms;
    const pages = yield* ReviewPages;
    const handles = yield* SubscriptionRef.get(rooms.handles);
    let handle: (typeof handles)[number] | undefined;
    for (const h of handles) if ((yield* SubscriptionRef.get(h.room.tickets)).has(ticketId)) handle = h;
    if (!handle) return HttpServerResponse.text("no ticket", { status: 404 });
    const { room } = handle;
    const tree = yield* reviewTree(ticketId);
    const sources: Array<Stream.Stream<void>> = [
      afterFirst(SubscriptionRef.changes(room.reviews).pipe(Stream.map((rs) => rs.find((r) => r.ticketId === ticketId)?.ts ?? 0))),
      afterFirst(SubscriptionRef.changes(room.tickets).pipe(Stream.map((m) => JSON.stringify(m.get(ticketId) ?? null)))),
      ...(typeof tree === "string" ? [] : [afterFirst(Stream.tick(COMMIT_EVERY).pipe(Stream.mapEffect(() => commitOf(tree.projectPath, tree.ref))))]),
    ];
    const events = Stream.mergeAll(
      [
        Stream.make("retry: 2000\n\n"),
        Stream.mergeAll(sources, { concurrency: "unbounded" }).pipe(Stream.map(() => "event: changed\ndata: {}\n\n")),
        Stream.tick(KEEP_ALIVE).pipe(Stream.map(() => ": keep-alive\n\n")),
      ],
      { concurrency: "unbounded" },
    );
    pages.opened(ticketId);
    const body = events.pipe(
      Stream.encodeText,
      Stream.ensuring(Effect.sync(() => pages.closed(ticketId))),
    );
    return HttpServerResponse.stream(body, { contentType: "text/event-stream", headers: { "cache-control": "no-cache", connection: "keep-alive" } });
  }),
);
