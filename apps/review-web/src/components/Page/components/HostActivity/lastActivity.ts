import { kept } from "~/kept";
import { ticketId } from "~/ticket";

/** What the host's section was the last time this review was open: there
 *  (a pull request), and with something said on it (a row to unfold). */
export interface Activity {
  readonly shown: boolean;
  readonly talked: boolean;
}

export const lastActivity = kept(
  `collagen.activity.v1.${ticketId}`,
  (value): value is Activity => typeof value === "object" && value !== null && "shown" in value && "talked" in value,
);
