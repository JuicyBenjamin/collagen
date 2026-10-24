import { useAtomSet } from "@effect/atom-react";
import { focusAtom } from "../../components/focus";
import { mergesProjectAtom } from "./merges/atoms";
import { routeName, useRouter, type Route } from "../../app/router";

export const TABS = ["room/overview", "room/projects", "room/merges", "room/messages", "room/outbox"] as const satisfies ReadonlyArray<Route>;
export type TabRoute = (typeof TABS)[number];

/** The room's tabs are sub-routes. Jumping to one also puts the cursor back
 *  on the tab bar — used by the layout's number keys and the bar's arrows.
 *  A ticket page belongs to the overview tab (it opened from its list).
 *  The merges tab opens on the person's first project. */
export function useTabs(): { active: TabRoute; jump: (to: TabRoute) => void } {
  const { route, navigate } = useRouter();
  const setFocus = useAtomSet(focusAtom);
  const setMergesProject = useAtomSet(mergesProjectAtom);
  const name = routeName(route);
  const active: TabRoute = name === "room/messages" || name === "room/outbox" || name === "room/merges" || name === "room/projects" ? name : "room/overview";
  return {
    active,
    jump: (to) => {
      if (to === "room/merges" && to !== active) setMergesProject(null);
      navigate(to);
      setFocus("tabs");
    },
  };
}
