import type { Show } from "~/data";

/** The host a page runs on, or that it runs on its author's machine. */
export const where = (show: Show, author: string): string => {
  if (show.local) return `local to ${author}`;
  try {
    return new URL(show.url).host;
  } catch {
    return "";
  }
};
