import { ticketId } from "./ticket";
import { viewedStore } from "./viewed";

/** This page's marks: one review, one store. */
export const viewed = viewedStore(ticketId);
