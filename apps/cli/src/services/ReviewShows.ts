import { Effect } from "effect";
import type { ReviewShow } from "@collagen/p2p";
import type { SendResult } from "@collagen/review-web/data";
import { authorization, BODY_MAX, headerOk, isLocalUrl, originOf, showGap } from "../lib/shows";
import { isInstancePort } from "./mcpAddress";
import { reviewNamed } from "./ReviewView";
import { StateStore } from "./StateStore";

// A review's change, running: the page shows where it can be seen and sends
// its requests again from the reader's own instance — not the browser, which
// a request's origin would refuse — signed in with the reader's own token
// for that origin. The token lives in this profile's state and nowhere else:
// not the log, not a peer, not the page.

/** How long a request may take before the page is told it did not answer. */
const TIMEOUT = 20_000;

/** The request a show names, as the reader's ticket has it — checked again
 *  here: a record on the log may come from any build. */
type Request = { readonly error: string } | { readonly show: ReviewShow; readonly origin: string };
const no = (error: string): Request => ({ error });
const requestOf = (ticketId: string, showId: string) =>
  Effect.gen(function* () {
    const found = yield* reviewNamed(ticketId);
    if (!found) return no(`no review ticket ${ticketId} in your rooms`);
    const show = found.review.shows?.find((candidate) => candidate.id === showId);
    if (!show) return no("this review no longer has that request");
    if (!show.method) return no("that is a page to open, not a request");
    const gap = showGap(show);
    if (gap) return no(gap.replace(/^failed: /, ""));
    const origin = originOf(show.url);
    if (!origin) return no("not an http url");
    // a collagen on this machine — the reader's own, or another profile's —
    // answers its agents' tools there: nobody else's request reaches it
    if (isLocalUrl(show.url) && isInstancePort(Number(new URL(show.url).port))) return no("that address is a collagen on this machine — not sent");
    return { show, origin } satisfies Request as Request;
  });

/** The first `max` bytes of a response, and whether there was more — the
 *  rest is never read. */
const upTo = async (response: Response, max: number): Promise<{ readonly bytes: Uint8Array; readonly cut?: true }> => {
  if (!response.body) return { bytes: new Uint8Array() };
  const reader = response.body.getReader();
  const parts: Array<Uint8Array> = [];
  let read = 0;
  while (read <= max) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    read += value.length;
  }
  if (read > max) await reader.cancel().catch(() => undefined);
  const all = new Uint8Array(read);
  let at = 0;
  for (const part of parts) {
    all.set(part, at);
    at += part.length;
  }
  return read <= max ? { bytes: all } : { bytes: all.slice(0, max), cut: true };
};

/** Send a review's request from this machine. The reader's body replaces the
 *  record's when given; their token goes only to the origin it was kept for,
 *  and a redirect is reported, never followed — a token never leaves for
 *  somewhere else. */
export const sendShow = Effect.fn("ReviewShows.send")(function* (ticketId: string, showId: string, body: string | null) {
  const got = yield* requestOf(ticketId, showId);
  if ("error" in got) return { error: got.error } satisfies SendResult;
  const { show, origin } = got;
  const method = show.method!;
  const payload = method === "GET" || method === "HEAD" ? undefined : (body ?? show.body);
  const headers = new Headers();
  for (const header of show.headers ?? []) if (headerOk(header.name, header.value)) headers.set(header.name, header.value);
  if (payload !== undefined && !headers.has("content-type") && /^\s*[[{]/.test(payload)) headers.set("content-type", "application/json");
  const token = (yield* (yield* StateStore).get).signIns?.[origin];
  if (token) headers.set("authorization", authorization(token));
  const started = Date.now();
  return yield* Effect.tryPromise({
    try: async (): Promise<SendResult> => {
      const response = await fetch(show.url, { method, headers, ...(payload !== undefined ? { body: payload } : {}), redirect: "manual", signal: AbortSignal.timeout(TIMEOUT) });
      const { bytes, cut } = await upTo(response, BODY_MAX);
      const type = response.headers.get("content-type") ?? undefined;
      const location = response.status >= 300 && response.status < 400 ? (response.headers.get("location") ?? undefined) : undefined;
      return {
        status: response.status,
        statusText: response.statusText,
        ...(type ? { type } : {}),
        body: new TextDecoder().decode(bytes),
        ...(cut ? { cut } : {}),
        elapsed: Date.now() - started,
        ...(location ? { location } : {}),
      };
    },
    catch: (error) => ({ timedOut: error instanceof Error && error.name === "TimeoutError" }),
  }).pipe(
    Effect.catch((failure) =>
      Effect.succeed<SendResult>({
        error: failure.timedOut ? `no answer from ${origin} in ${TIMEOUT / 1000}s` : `${origin} could not be reached${isLocalUrl(show.url) ? " — it runs on its author's machine" : ""}`,
      }),
    ),
  );
});

/** Keep the reader's token for a show's origin, or forget it (null). */
export const signInShow = Effect.fn("ReviewShows.signIn")(function* (ticketId: string, showId: string, token: string | null) {
  const got = yield* requestOf(ticketId, showId);
  if ("error" in got) return { error: got.error };
  const store = yield* StateStore;
  yield* store.update((current) => {
    const { [got.origin]: _gone, ...rest } = current.signIns ?? {};
    const signIns = token === null ? rest : { ...rest, [got.origin]: token.trim() };
    const { signIns: _old, ...state } = current;
    return Object.keys(signIns).length > 0 ? { ...state, signIns } : state;
  });
  return { ok: true as const };
});
