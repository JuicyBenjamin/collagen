import { useAtomSet } from "@effect/atom-react";
import { focusAtom } from "../../components/focus";
import { routeName, useRouter, type Route } from "../../app/router";

export const TABS = ["room/overview", "room/messages"] as const satisfies ReadonlyArray<Route>;
export type TabRoute = (typeof TABS)[number];

/** The room's tabs are sub-routes. Jumping to one also puts the cursor back
 *  on the tab bar — used by the layout's number keys and the bar's arrows.
 *  A ticket page belongs to the overview tab (it opened from its list). */
export function useTabs(): { active: TabRoute; jump: (to: TabRoute) => void } {
  const { route, navigate } = useRouter();
  const setFocus = useAtomSet(focusAtom);
  const active: TabRoute = routeName(route) === "room/messages" ? "room/messages" : "room/overview";
  return {
    active,
    jump: (to) => {
      navigate(to);
      setFocus("tabs");
    },
  };
}
