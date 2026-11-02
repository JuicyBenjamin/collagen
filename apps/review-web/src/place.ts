// Where this page is, as collagen found it when it served the page: written
// into the document (services/ReviewView's pageAt), so the page draws what
// it is at once — a ticket's address is the same whatever its kind, and the
// kind says which page it is. Addresses go by the room's short id; the full
// ids the reads need come from here, never from the address.

export type Place =
  | { readonly page: "review" | "investigation" | "ticket"; readonly kind: string; readonly room: string; readonly roomShort: string; readonly ticket: string }
  | { readonly page: "audit"; readonly room: string; readonly roomShort: string }
  | { readonly page: "merges"; readonly room: string; readonly roomShort: string; readonly project: string | null };

/** This page's place; null where collagen wrote none (a page opened apart from it). */
export const place: Place | null = (() => {
  const said = typeof document === "undefined" ? undefined : document.querySelector<HTMLMetaElement>('meta[name="collagen-place"]')?.content;
  if (!said) return null;
  try {
    return JSON.parse(said) as Place;
  } catch {
    return null;
  }
})();

/** How many characters of a ticket's id its address carries (cli lib/pageAddress). */
const TICKET_SHORT = 8;

/** A ticket's page in this page's room. */
export const ticketHref = (ticketId: string): string => `/room/${place?.roomShort ?? ""}/ticket/${encodeURIComponent(ticketId.slice(0, TICKET_SHORT))}`;

/** A project's merges in this page's room, at one of its merges when `number` names it. */
export const mergesHref = (project: string, number?: number): string => `/room/${place?.roomShort ?? ""}/merges/${encodeURIComponent(project)}${number === undefined ? "" : `#${number}`}`;
