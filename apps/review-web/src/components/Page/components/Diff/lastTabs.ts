import { kept } from "~/kept";
import { ticketId } from "~/ticket";

/** How many tests the review's Tests tab counted the last time it was open
 *  (0: no tab) — its placeholder shows that tab, as wide, next time. */
export const lastTabs = kept(`collagen.tabs.v1.${ticketId}`, (value): value is { readonly tests: number } => typeof value === "object" && value !== null && Number.isInteger((value as { tests?: unknown }).tests));
