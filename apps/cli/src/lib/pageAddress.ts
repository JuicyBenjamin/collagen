import { shortRoomId } from "@collagen/p2p";

// Where each of the instance's pages lives: under the room it belongs to,
// by the room's short id, never its full one — that doubles as the room's
// invite secret, and an address ends up in history, logs and chats. A
// ticket's page is one address whatever its kind; the page drawn follows
// the kind (services/ReviewView). Tickets go by their first eight
// characters: random ids, so two of one room's never share them.

/** How many characters of a ticket's id its address carries. */
export const TICKET_SHORT = 8;

/** A room's own address. */
export const roomPath = (roomId: string): string => `/room/${shortRoomId(roomId)}`;

/** A ticket's page: a review, an investigation, or any other kind. */
export const ticketPath = (roomId: string, ticketId: string): string => `${roomPath(roomId)}/ticket/${encodeURIComponent(ticketId.slice(0, TICKET_SHORT))}`;

/** A room's board: its tickets in to do, in progress and done. */
export const boardPath = (roomId: string): string => `${roomPath(roomId)}/board`;

/** A room's audit. */
export const auditPath = (roomId: string): string => `${roomPath(roomId)}/audit`;

/** A room's merges — a project's, at one of its merges when `at` names it. */
export const mergesPath = (roomId: string, project?: string, at?: number): string =>
  `${roomPath(roomId)}/merges${project === undefined ? "" : `/${encodeURIComponent(project)}${at === undefined ? "" : `#${at}`}`}`;
