import { createContext, useContext, useState, type ReactNode } from "react";

/** A route that carries parameters. */
export interface TicketRoute {
  readonly name: "room/ticket";
  readonly ticketId: string;
}
export interface TranscriptsRoute {
  readonly name: "room/transcripts";
  /** Which collection to list: a subject folder, or "" for all of them. */
  readonly subject: string;
  /** Where esc / ← go. */
  readonly back: Route;
}
export interface TranscriptRoute {
  readonly name: "room/transcript";
  readonly path: string;
  readonly file: string;
  /** Where esc / ← go — the list this was opened from. */
  readonly back: Route;
}

/** Where the configured app can be. Plain routes are strings; a route with
 *  parameters is an object. `room/*` routes render inside the room layout
 *  (see routes/index.tsx for the table that maps each to its page). */
export type Route = "settings" | "new-room" | "room/overview" | "room/messages" | TicketRoute | TranscriptsRoute | TranscriptRoute;

export type RouteName = Route extends infer R ? (R extends string ? R : R extends { readonly name: infer N } ? N : never) : never;

export const routeName = (route: Route): RouteName => (typeof route === "string" ? route : route.name);

/** Constructors for the routes that carry parameters. */
export const to = {
  ticket: (ticketId: string): Route => ({ name: "room/ticket", ticketId }),
  transcripts: (subject: string, back: Route): Route => ({ name: "room/transcripts", subject, back }),
  transcript: (path: string, file: string, back: Route): Route => ({ name: "room/transcript", path, file, back }),
} as const;

interface Router {
  route: Route;
  navigate: (to: Route) => void;
}

const RouterContext = createContext<Router | null>(null);

export function RouterProvider({ initial, children }: { initial: Route; children: ReactNode }) {
  const [route, setRoute] = useState<Route>(initial);
  return <RouterContext.Provider value={{ route, navigate: setRoute }}>{children}</RouterContext.Provider>;
}

export function useRouter(): Router {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error("useRouter outside <RouterProvider>");
  return ctx;
}
