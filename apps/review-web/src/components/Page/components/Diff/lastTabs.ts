import { kept } from "~/kept";
import { ticketId } from "~/ticket";

/** How many tests the review's Tests tab counted the last time it was open
 *  (0: no tab), and how many files its Code tab did — its placeholder shows
 *  those tabs, as wide, next time. */
export const lastTabs = kept(
  `collagen.tabs.v1.${ticketId}`,
  (value): value is { readonly tests: number; readonly files?: number } =>
    typeof value === "object" && value !== null && Number.isInteger((value as { tests?: unknown }).tests) && ((value as { files?: unknown }).files === undefined || Number.isInteger((value as { files?: unknown }).files)),
);
