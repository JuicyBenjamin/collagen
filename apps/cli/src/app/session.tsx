import { createContext, useContext, type ReactNode } from "react";

/** Who this process runs as. Which room is being looked at is live state
 *  (see routes/atoms.ts `roomAtom`), not part of the session. */
export interface Session {
  profile: string;
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
