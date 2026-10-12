import { useAtomSet } from "@effect/atom-react";
import { focusAtom } from "../../components/focus";
import { routeName, useRouter, type Route } from "../../app/router";

export const TABS = ["room/overview", "room/projects", "room/merges", "room/messages", "room/outbox", "room/board"] as const satisfies ReadonlyArray<Route>;
export type TabRoute = (typeof TABS)[number];

/** The room's tabs are sub-routes. Jumping to one also puts the cursor back
 *  on the tab bar — used by the layout's number keys and the bar's arrows.
 *  A page opened from another belongs to the tab the first was opened
 *  from: the board's, say, or the overview's list. */
export function useTabs(): { active: TabRoute; jump: (to: TabRoute) => void } {
  const { route, navigate } = useRouter();
  const setFocus = useAtomSet(focusAtom);
  const from = routeName(origin(route));
  const active: TabRoute = TABS.find((tab) => tab === from) ?? "room/overview";
  return {
    active,
    jump: (to) => {
      navigate(to);
      setFocus("tabs");
    },
  };
}

/** The route a chain of pages was first opened from: back, and back again. */
const origin = (route: Route): Route => (typeof route === "object" && "back" in route && route.back !== undefined ? origin(route.back) : route);
