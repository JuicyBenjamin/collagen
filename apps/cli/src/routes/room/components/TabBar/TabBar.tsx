import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { Focusable } from "../../../../components/Focusable";
import { focusAtom, nearestFocusable } from "../../../../components/focus";
import { isEnter } from "../../../../components/keys";
import { useSession } from "../../../../app/session";
import { theme } from "../../../../app/theme";
import { inboundMessagesAtom, rosterAtom, sentMessagesAtom, stateAtom } from "../../atoms";
import { projectRows } from "../../projectRows";
import { TABS, useTabs } from "../../tabs";

/** The tab bar is a section: hover it and ←→ switch tabs; ↓ (or enter) drops
 *  the cursor into whatever section sits below. Also carries the room's vitals. */
export function TabBar() {
  const { room } = useSession();
  const { active, jump } = useTabs();
  const setFocus = useAtomSet(focusAtom);
  const peers = AsyncResult.getOrElse(useAtomValue(rosterAtom), () => [] as const);
  const state = AsyncResult.getOrElse(useAtomValue(stateAtom), () => ({ preferredAi: null, rooms: {} }));
  const inbound = AsyncResult.getOrElse(useAtomValue(inboundMessagesAtom), () => [] as const);
  const sent = AsyncResult.getOrElse(useAtomValue(sentMessagesAtom), () => [] as const);

  const shared = projectRows(state, room.id, peers).filter((r) => r.holders.length >= 2).length;

  return (
    <Focusable
      id="tabs"
      hint="←→ switch tab · ↓ into the tab · 1/2 jump · a cycle ai · c copy invite · s settings · q quit"
      onKey={(key) => {
        const i = TABS.indexOf(active);
        if (key.name === "left" && i > 0) return jump(TABS[i - 1]!), true;
        if (key.name === "right" && i < TABS.length - 1) return jump(TABS[i + 1]!), true;
        // enter behaves like ↓: hand the cursor to whatever sits below
        if (isEnter(key)) {
          const below = nearestFocusable("tabs", "down");
          if (below !== null) setFocus(below);
          return true;
        }
        // ←/→ at the ends stay put rather than wandering sideways
        return key.name === "left" || key.name === "right";
      }}
    >
      {(focused) => (
        <text truncate wrapMode="none">
          <span fg={focused ? theme.accent : theme.dim}>{focused ? "› " : "  "}</span>
          <span fg={active === "room/overview" ? theme.accent : theme.dim}>[1] overview</span>
          <span fg={theme.dim}>   </span>
          <span fg={active === "room/messages" ? theme.accent : theme.dim}>[2] messages</span>
          <span fg={theme.dim}> ({inbound.length + sent.length})</span>
          <span fg={theme.dim}>   ·   </span>
          <span fg={theme.fg}>{peers.length + 1} online</span>
          <span fg={theme.dim}> · </span>
          <span fg={theme.fg}>{shared} shared</span>
          <span fg={theme.dim}> {shared === 1 ? "project" : "projects"}</span>
        </text>
      )}
    </Focusable>
  );
}
