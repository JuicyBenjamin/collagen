import { useEffect, useState } from "react";
import { treaty } from "@elysiajs/eden";
import type { App } from "@collagen/server";

export interface Member {
  clientId: string;
  name: string;
}

// Eden treaty wants host without protocol (e.g. "localhost:3000").
const host = (process.env.COLLAGEN_SERVER ?? "http://localhost:3000").replace(/^https?:\/\//, "");

/** Live roster of who is in a room, via the presence WebSocket. */
export function usePresence(roomId: string | null, name: string): Member[] {
  const [members, setMembers] = useState<Member[]>([]);

  useEffect(() => {
    if (!roomId) {
      setMembers([]);
      return;
    }
    const api = treaty<App>(host);
    const ws = api.ws.subscribe({ query: { workspace: roomId, name } });
    ws.subscribe(({ data }) => {
      if (data && (data.type === "welcome" || data.type === "presence")) {
        setMembers(data.members);
      }
    });
    return () => {
      ws.close();
    };
  }, [roomId, name]);

  return members;
}
