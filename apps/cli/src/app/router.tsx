import { createContext, useContext, useState, type ReactNode } from "react";

/** Frames the configured app can show. Nested paths are tabs inside the room layout. */
export type Route = "settings" | "room/overview" | "room/messages";

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
