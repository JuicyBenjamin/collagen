import { createContext, useContext, type ReactNode } from "react";

/** Who this process runs as and which room it joined — fixed once the
 *  runtime builds (collagen runs one room per process). Owned by the app,
 *  read by any frame or section that needs it. */
export interface Session {
  profile: string;
  room: { id: string; name: string };
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ session, children }: { session: Session; children: ReactNode }) {
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession outside a configured session (setup not finished?)");
  return ctx;
}
