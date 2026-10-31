import type { ReactNode } from "react";
import { routeName, useRouter, type Route, type RouteName } from "../app/router";
import { NewRoomPage } from "./new-room/page";
import { RoomLayout } from "./room/layout";
import { MessagesPage } from "./room/messages/page";
import { MergesPage } from "./room/merges/page";
import { OutboxPage } from "./room/outbox/page";
import { PeoplePage } from "./room/people/page";
import { ProjectsPage } from "./room/projects/page";
import { OverviewPage } from "./room/overview/page";
import { AttachPage } from "./room/attach/page";
import { ReviewPage } from "./room/review/page";
import { TicketPage } from "./room/ticket/page";
import { TranscriptPage } from "./room/transcript/page";
import { TranscriptsPage } from "./room/transcripts/page";
import { SettingsPage } from "./settings/page";
import { YouPage } from "./you/page";
import { RenameRoomPage } from "./rename-room/page";

/** The route table: one page per route. Adding a route = a folder with a
 *  `page.tsx`, a `Route` member, and a line here. */
const pages: { readonly [N in RouteName]: (route: Extract<Route, N | { readonly name: N }>) => ReactNode } = {
  settings: () => <SettingsPage />,
  you: () => <YouPage />,
  "rename-room": () => <RenameRoomPage />,
  "new-room": () => <NewRoomPage />,
  "room/overview": () => <OverviewPage />,
  "room/messages": () => <MessagesPage />,
  "room/outbox": () => <OutboxPage />,
  "room/merges": () => <MergesPage />,
  "room/projects": () => <ProjectsPage />,
  "room/people": () => <PeoplePage />,
  "room/ticket": (route) => <TicketPage ticketId={route.ticketId} route={route} />,
  "room/transcripts": (route) => <TranscriptsPage subject={route.subject} />,
  "room/transcript": (route) => <TranscriptPage path={route.path} file={route.file} />,
  "room/attach": (route) => <AttachPage ticketId={route.ticketId} back={route.back} />,
  "room/review": (route) => <ReviewPage ticketId={route.ticketId} />,
};

/** Layouts wrap every route under their prefix. */
const layouts: ReadonlyArray<{ readonly prefix: string; readonly Layout: (p: { children: ReactNode; onExit: (code?: number) => void }) => ReactNode }> = [
  { prefix: "room/", Layout: RoomLayout },
];

/** Renders the current route inside its layouts. */
export function RouterView({ onExit }: { onExit: (code?: number) => void }) {
  const { route } = useRouter();
  const name = routeName(route);
  const render = pages[name] as (route: Route) => ReactNode;
  let page = render(route);
  for (const { prefix, Layout } of layouts) {
    if (name.startsWith(prefix)) page = <Layout onExit={onExit}>{page}</Layout>;
  }
  return <>{page}</>;
}
