import { useState } from "react";
import { Option } from "effect";
import { v7 as uuidv7 } from "uuid";
import { upsertActiveRoom, writeProfileFile } from "../config/profileFile";
import { RouterProvider, useRouter } from "./router";
import { setCliArgs } from "./runtime";
import { SessionProvider, type Session } from "./session";
import { RootLayout } from "../routes/layout";
import { RoomLayout } from "../routes/room/layout";
import { MessagesPage } from "../routes/room/messages/page";
import { OverviewPage } from "../routes/room/overview/page";
import { SetupPage } from "../routes/setup/page";
import { SettingsPage } from "../routes/settings/page";

/** The app: a router over frames, each rendered inside its layouts.
 *
 *   RootLayout (brand)
 *   ├─ setup            first run — before a session exists
 *   ├─ settings
 *   └─ RoomLayout (status · room panel · footer)
 *      ├─ room/overview
 *      └─ room/messages
 *
 *  Nothing subscribes to a runtime atom until a session exists, so the
 *  swarm/MCP runtime only builds once the user is configured. */
export function App({
  profile,
  initialName,
  room,
  onExit,
}: {
  profile: string;
  initialName: string;
  /** Resolved from flags/profile; undefined = first run, show setup. */
  room: Session["room"] | undefined;
  onExit: () => void;
}) {
  const [session, setSession] = useState<Session | null>(room ? { profile, room } : null);

  if (session === null) {
    return (
      <RootLayout>
        <SetupPage
          initialName={initialName}
          onDone={({ name, mode, roomName, roomId }) => {
            // create: fresh unguessable id, and the chosen name is stamped so it
            // is sent to joiners; join: the pasted invite IS the id, labeled by
            // its short prefix (ts 0) until the room's shared name arrives.
            const id = mode === "create" ? uuidv7() : roomId;
            const label = mode === "create" ? roomName : roomId.slice(0, 8);
            writeProfileFile(profile, { name });
            upsertActiveRoom(profile, { id, name: label, ...(mode === "create" ? { nameTs: Date.now() } : {}) });
            setCliArgs({ profile, name: Option.some(name), room: Option.some(id) });
            setSession({ profile, room: { id, name: label } });
          }}
        />
      </RootLayout>
    );
  }

  return (
    <SessionProvider session={session}>
      <RouterProvider initial="room/overview">
        <RootLayout>
          <Frames onExit={onExit} />
        </RootLayout>
      </RouterProvider>
    </SessionProvider>
  );
}

function Frames({ onExit }: { onExit: () => void }) {
  const { route } = useRouter();
  if (route === "settings") return <SettingsPage />;
  return <RoomLayout onExit={onExit}>{route === "room/messages" ? <MessagesPage /> : <OverviewPage />}</RoomLayout>;
}
