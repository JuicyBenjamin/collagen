import type { ReviewShow } from "@collagen/p2p";
import type { Show } from "@collagen/review-web/data";
import { TITLE_MAX } from "./review";

// Where a review's change can be seen running (p2p ReviewShow): a page to
// open, or a request to send again. The record rides the room's log, so
// nothing on it may be a credential — each reader signs in on their own
// machine and their token stays in their own state (LocalState.signIns).
// These are the checks both ends make: the author's tool before filing, and
// the reader's instance before sending (a record can be written by any build).

export const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;

/** The most of a body a request carries, or a page shows back. */
export const BODY_MAX = 64 * 1024;

/** Header names that carry a credential. */
const SECRET = /authori[sz]ation|cookie|token|secret|password|passwd|api[-_]?key|session|credential|private[-_]?key|client[-_]?secret/i;

/** A field — in a query or a body — whose value is a credential: its name,
 *  any case, with or without - and _ ("access_token", "apiKey"). */
const SECRET_FIELDS = new Set(["password", "passwd", "secret", "token", "accesstoken", "refreshtoken", "idtoken", "apikey", "clientsecret", "privatekey", "credential", "credentials", "authorization", "auth"]);
const secretField = (name: string): boolean => SECRET_FIELDS.has(name.replace(/[-_]/g, "").toLowerCase());

/** Headers a request may carry from the record: plain names, nothing secret,
 *  nothing the connection itself decides. */
const HOP = new Set(["host", "connection", "content-length", "transfer-encoding", "upgrade", "keep-alive", "te", "trailer", "proxy-connection"]);
export const headerOk = (name: string, value: string): boolean =>
  /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/.test(name) && !HOP.has(name.toLowerCase()) && !SECRET.test(name) && !/^(bearer|basic|token)\s/i.test(value.trim()) && !/[\r\n]/.test(value) && value.length <= 1024;

/** A url a show may name: http(s), no password in it, no credential in its query. */
export const urlGap = (raw: string, what = "url"): string | null => {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return `'${what}' is not a url: ${raw.slice(0, 80)}`;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return `'${what}' must be http or https`;
  if (parsed.username || parsed.password) return `'${what}' carries a sign-in — every reader signs in on their own machine; leave it out`;
  for (const key of parsed.searchParams.keys()) if (secretField(key)) return `'${what}' carries a credential in "${key}" — every reader signs in on their own machine; leave it out`;
  return null;
};

/** A body that holds a credential's value — a password or a token in JSON or a form. */
const secretInBody = (body: string): string | null => {
  const json = /"([^"]{1,64})"\s*:\s*"[^"]+"/g;
  for (const match of body.matchAll(json)) if (secretField(match[1]!)) return match[1]!;
  for (const match of body.matchAll(/(?:^|&)([^=&\s]{1,64})=[^&\s]+/g)) if (secretField(match[1]!)) return match[1]!;
  return null;
};

export interface ShowInput {
  readonly id?: string;
  readonly title: string;
  readonly url: string;
  readonly method?: string;
  readonly body?: string;
  readonly headers?: ReadonlyArray<{ readonly name: string; readonly value: string }>;
  readonly signIn?: string;
}

/** What is wrong with a show before it goes on the ticket, said as the thing
 *  to fix — or null. A credential anywhere in it is refused: the log reaches
 *  every peer. */
export const showGap = (show: ShowInput): string | null => {
  const at = show.id ?? `"${show.title.slice(0, 40)}"`;
  const title = show.title.trim();
  if (title.length === 0) return `failed: show ${at} has no 'title' — what it shows, a few words`;
  if (/[\r\n]/.test(title) || title.length > TITLE_MAX) return `failed: show ${at}'s title is a headline: one line, ${TITLE_MAX} characters at most`;
  const url = urlGap(show.url);
  if (url) return `failed: show ${at}: ${url}`;
  if (show.signIn !== undefined) {
    const gap = urlGap(show.signIn, "signIn");
    if (gap) return `failed: show ${at}: ${gap}`;
  }
  const method = show.method?.trim().toUpperCase();
  if (method === undefined) {
    if (show.body !== undefined || (show.headers?.length ?? 0) > 0) return `failed: show ${at} has a body or headers but no 'method' — a request needs one; a page to open has neither`;
    return null;
  }
  if (!(METHODS as ReadonlyArray<string>).includes(method)) return `failed: show ${at}'s method must be one of ${METHODS.join(", ")}`;
  if (show.body !== undefined && (method === "GET" || method === "HEAD")) return `failed: show ${at} is a ${method} — it carries no body`;
  if (show.body !== undefined && show.body.length > BODY_MAX) return `failed: show ${at}'s body is over ${BODY_MAX / 1024} KB`;
  const inBody = show.body === undefined ? null : secretInBody(show.body);
  if (inBody) return `failed: show ${at}'s body carries a credential in "${inBody}" — it would reach every peer. Leave the value out; every reader signs in on their own machine`;
  for (const header of show.headers ?? []) {
    if (!headerOk(header.name, header.value)) return `failed: show ${at}'s header "${header.name.slice(0, 40)}" is a credential or not a plain header — every reader signs in on their own machine; leave it out`;
  }
  return null;
};

/** A show as it goes on the record: trimmed, its method in capitals. */
export const cleanShow = (show: ShowInput): Omit<ReviewShow, "id"> & { readonly id?: string } => ({
  ...(show.id ? { id: show.id } : {}),
  title: show.title.trim(),
  url: show.url.trim(),
  ...(show.method ? { method: show.method.trim().toUpperCase() } : {}),
  ...(show.body !== undefined ? { body: show.body } : {}),
  ...(show.headers && show.headers.length > 0 ? { headers: show.headers.map((header) => ({ name: header.name.trim(), value: header.value.trim() })) } : {}),
  ...(show.signIn ? { signIn: show.signIn.trim() } : {}),
});

/** Runs on its author's own machine: a loopback or `.localhost` address. */
export const isLocalUrl = (raw: string): boolean => {
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return host === "localhost" || host.endsWith(".localhost") || host === "[::1]" || host === "0.0.0.0" || /^127\.\d+\.\d+\.\d+$/.test(host);
  } catch {
    return false;
  }
};

/** The origin a token is kept for — scheme, host and port. Null for a url that is not one. */
export const originOf = (raw: string): string | null => {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
};

/** The Authorization header for a token as pasted: a bare token is a
 *  bearer one; one with a scheme ("Basic …", "Token …") is sent as it is. */
export const authorization = (token: string): string => {
  const trimmed = token.trim();
  return /^[A-Za-z][\w-]*\s+\S/.test(trimmed) ? trimmed : `Bearer ${trimmed}`;
};

/** A token as the page hands it over: one line, not empty, not huge. */
export const tokenOk = (given: unknown): given is string => typeof given === "string" && given.trim().length > 0 && given.length <= 8192 && !/[\r\n]/.test(given.trim());

/** A review's shows as the page has them: whether each runs on its author's
 *  machine, and whether the reader holds a token for a request's origin.
 *  The page links their urls, and a record may come from any build: one
 *  that is not http(s) is left out, a sign-in page that is not loses its link. */
export const shownShows = (shows: ReadonlyArray<ReviewShow> | undefined, signIns: Readonly<Record<string, string>> | undefined): ReadonlyArray<Show> | undefined => {
  const out = (shows ?? []).flatMap((show): ReadonlyArray<Show> => {
    const origin = originOf(show.url);
    if (origin === null) return [];
    const { signIn, ...rest } = show;
    return [{ ...rest, ...(signIn !== undefined && originOf(signIn) !== null ? { signIn } : {}), local: isLocalUrl(show.url), ...(show.method ? { signedIn: signIns?.[origin] !== undefined } : {}) }];
  });
  return out.length > 0 ? out : undefined;
};
