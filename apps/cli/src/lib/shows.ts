import type { ReviewShow } from "@collagen/p2p";
import type { Show } from "@collagen/review-web/data";
import { TITLE_MAX } from "./review";

// Where a review's change can be seen running (p2p ReviewShow): a page to
// open. The record rides the room's log to every peer, so nothing on it may
// be a credential. These are the checks both ends make: the author's tool
// before filing, and the reader's instance before linking (a record can be
// written by any build).

/** A field in a query whose value is a credential: its name, any case, with
 *  or without - and _ ("access_token", "apiKey"). */
const SECRET_FIELDS = new Set(["password", "passwd", "secret", "token", "accesstoken", "refreshtoken", "idtoken", "apikey", "clientsecret", "privatekey", "credential", "credentials", "authorization", "auth"]);
const secretField = (name: string): boolean => SECRET_FIELDS.has(name.replace(/[-_]/g, "").toLowerCase());

/** A url a show may name: http(s), no password in it, no credential in its query. */
export const urlGap = (raw: string): string | null => {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return `'url' is not a url: ${raw.slice(0, 80)}`;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "'url' must be http or https";
  if (parsed.username || parsed.password) return "'url' carries a sign-in — it would reach every peer; leave it out";
  for (const key of parsed.searchParams.keys()) if (secretField(key)) return `'url' carries a credential in "${key}" — it would reach every peer; leave it out`;
  return null;
};

export interface ShowInput {
  readonly id?: string;
  readonly title: string;
  readonly url: string;
}

/** What is wrong with a show before it goes on the ticket, said as the thing
 *  to fix — or null. */
export const showGap = (show: ShowInput): string | null => {
  const at = show.id ?? `"${show.title.slice(0, 40)}"`;
  const title = show.title.trim();
  if (title.length === 0) return `failed: show ${at} has no 'title' — what it shows, a few words`;
  if (/[\r\n]/.test(title) || title.length > TITLE_MAX) return `failed: show ${at}'s title is a headline: one line, ${TITLE_MAX} characters at most`;
  const url = urlGap(show.url);
  return url ? `failed: show ${at}: ${url}` : null;
};

/** A show as it goes on the record: trimmed. */
export const cleanShow = (show: ShowInput): Omit<ReviewShow, "id"> & { readonly id?: string } => ({
  ...(show.id ? { id: show.id } : {}),
  title: show.title.trim(),
  url: show.url.trim(),
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

const isHttp = (raw: string): boolean => {
  try {
    const protocol = new URL(raw).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

/** A review's shows as its reader has them. A page that runs on its
 *  author's machine is the author's alone: nobody else can open it, so to
 *  anyone else it is not there at all. The page links their urls, and a
 *  record may come from any build: one that is not http(s) is left out. */
export const shownShows = (shows: ReadonlyArray<ReviewShow> | undefined, readerIsAuthor: boolean): ReadonlyArray<Show> | undefined => {
  const out = (shows ?? []).flatMap((show): ReadonlyArray<Show> => {
    const local = isLocalUrl(show.url);
    return isHttp(show.url) && (readerIsAuthor || !local) ? [{ id: show.id, title: show.title, url: show.url, local }] : [];
  });
  return out.length > 0 ? out : undefined;
};
