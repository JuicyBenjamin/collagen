import { useAtomSet } from "@effect/atom-react";
import { focusAtom } from "../../components/focus";
import { mergesProjectAtom } from "./merges/atoms";
import { routeName, useRouter, type Route } from "../../app/router";

/** In the order a person reaches for them: where things stand, the work, what landed, then the rest. */
export const TABS = ["room/overview", "room/board", "room/merges", "room/projects", "room/messages", "room/outbox"] as const satisfies ReadonlyArray<Route>;
export type TabRoute = (typeof TABS)[number];

/** Each tab's name on the bar, its number before it (1–6, in TABS' order). */
export const TAB_LABEL: Record<TabRoute, string> = {
  "room/overview": "overview",
  "room/board": "board",
  "room/merges": "merges",
  "room/projects": "projects",
  "room/messages": "messages",
  "room/outbox": "outbox",
};

/** The room's tabs are sub-routes. Jumping to one also puts the cursor back
 *  on the tab bar — used by the layout's number keys and the bar's arrows.
 *  A page opened from another belongs to the tab the first was opened
 *  from: the board's, say, or the overview's list. The merges tab opens on
 *  the person's first project. */
export function useTabs(): { active: TabRoute; jump: (to: TabRoute) => void } {
  const { route, navigate } = useRouter();
  const setFocus = useAtomSet(focusAtom);
  const setMergesProject = useAtomSet(mergesProjectAtom);
  const from = routeName(origin(route));
  const active: TabRoute = TABS.find((tab) => tab === from) ?? "room/overview";
  return {
    active,
    jump: (to) => {
      if (to === "room/merges" && to !== active) setMergesProject(null);
      navigate(to);
      setFocus("tabs");
    },
  };
}

/** The route a chain of pages was first opened from: back, and back again. */
const origin = (route: Route): Route => (typeof route === "object" && "back" in route && route.back !== undefined ? origin(route.back) : route);
