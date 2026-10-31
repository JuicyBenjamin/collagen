import type { Show } from "~/data";

/** The host a page runs on, or that it runs on this machine — a page on its
 *  author's machine reaches only its author. */
export const where = (show: Show): string => {
  if (show.local) return "on your machine";
  try {
    return new URL(show.url).host;
  } catch {
    return "";
  }
};
