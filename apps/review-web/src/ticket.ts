import { place } from "./place";

/** The ticket this page is about: its full id, as collagen wrote it into the page. */
export const ticketId = place && "ticket" in place ? place.ticket : "";
