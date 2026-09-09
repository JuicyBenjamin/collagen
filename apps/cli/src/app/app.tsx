import { useState } from "react";
import { Option } from "effect";
import { invitedRoomEntry, newRoomEntry, upsertActiveRoom, writeProfileFile } from "../config/profileFile";
import { RouterProvider } from "./router";
import { setCliArgs } from "./runtime";
import { SessionProvider, type Session } from "./session";
import { RouterView } from "../routes";
import { RootLayout } from "../routes/layout";
import { SetupPage } from "../routes/setup/page";

/** The app: setup until a session exists, then the router (routes/index.tsx
 *  maps each route to its page and wraps `room/*` in the room layout).
 *
 *   RootLayout (brand)
 *   ├─ setup            first run — before a session exists
 *   ├─ settings
 *   ├─ new-room         join or create another room (the sidebar's +)
 *   └─ RoomLayout (rooms sidebar · status · room panel · footer)
 *      ├─ room/overview      the lists: outbox, peers, tickets, projects
 *      ├─ room/ticket/:id    one ticket: steps, its conversation, diagnostics
 *      └─ room/messages
 *
 *  Nothing subscribes to a runtime atom until a session exists, so the
 *  swarm/MCP runtime only builds once the user is configured. */
export function App({
  profile,
  initialName,
  configured,
  onExit,
}: {
  profile: string;
  initialName: string;
  /** false = first run: no name or room yet, show setup. */
  configured: boolean;
  /** Quit; a code asks the bin shim to relaunch (see services/Updates RESTART_EXIT_CODE). */
  onExit: (code?: number) => void;
}) {
  const [session, setSession] = useState<Session | null>(configured ? { profile } : null);

  if (session === null) {
    return (
      <RootLayout>
        <SetupPage
          initialName={initialName}
          onDone={({ name, room }) => {
            const entry = room.mode === "create" ? newRoomEntry(room.name) : invitedRoomEntry(room.inviteId);
            writeProfileFile(profile, { name });
            upsertActiveRoom(profile, entry);
            setCliArgs({ profile, name: Option.some(name), room: Option.some(entry.id) });
            setSession({ profile });
          }}
        />
      </RootLayout>
    );
  }

  return (
    <SessionProvider session={session}>
      <RouterProvider initial="room/overview">
        <RootLayout live>
          <RouterView onExit={onExit} />
        </RootLayout>
      </RouterProvider>
    </SessionProvider>
  );
}
