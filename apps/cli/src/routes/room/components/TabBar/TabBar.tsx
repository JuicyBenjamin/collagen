import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { Focusable } from "../../../../components/Focusable";
import { focusAtom, nearestFocusable } from "../../../../components/focus";
import { isEnter } from "../../../../components/keys";
import { theme } from "../../../../app/theme";
import { admittedAtom, rosterAtom } from "../../atoms";
import { openMergesPageAtom } from "../../merges/atoms";
import { TABS, useTabs } from "../../tabs";

/** The tab bar is a section: hover it and ←→ switch tabs (← past the first
 *  tab leaves for whatever sits to the left — the rooms rail); ↓ (or enter)
 *  drops the cursor into whatever section sits below. Also carries the
 *  room's vitals — who is online. No counts on the tabs: the
 *  trace and the outbox are logs that only grow, so their size says nothing
 *  a person would act on. A number earns its place here only when it means
 *  "you have something to do". */
export function TabBar() {
  const { active, jump } = useTabs();
  const setFocus = useAtomSet(focusAtom);
  const peers = AsyncResult.getOrElse(useAtomValue(rosterAtom), () => [] as const);
  const admitted = AsyncResult.getOrElse(useAtomValue(admittedAtom), () => true);
  const openMergesPage = useAtomSet(openMergesPageAtom);

  const online = peers.filter((peer) => !peer.away).length + 1;

  return (
    <Focusable
      id="tabs"
      // one row, always: a page that grows must not push the bar off its line
      flexShrink={0}
      hint={`←→ switch tab · ↓ into the tab${active === "room/merges" ? " · o in browser" : ""} · 1-6 jump · a cycle ai · g steering · c copy invite · s settings · q quit`}
      onKey={(key) => {
        const index = TABS.indexOf(active);
        if (key.name === "left" && index > 0) return jump(TABS[index - 1]!), true;
        if (key.name === "right" && index < TABS.length - 1) return jump(TABS[index + 1]!), true;
        // o on the merges tab: the whole history as a web page, the latest first
        if (key.name === "o" && active === "room/merges") return openMergesPage({}), true;
        // enter behaves like ↓: hand the cursor to whatever sits below
        if (isEnter(key)) {
          const below = nearestFocusable("tabs", "down");
          if (below !== null) setFocus(below);
          return true;
        }
        // ←/→ at the ends are not ours: ← from the first tab reaches the rooms rail
        return false;
      }}
    >
      {(focused) => (
        // the tabs whole, always; the room's vitals in what is left
        <box flexDirection="row">
          <text wrapMode="none" flexShrink={0}>
            <span fg={focused ? theme.accent : theme.dim}>{focused ? "› " : "  "}</span>
            <span fg={active === "room/overview" ? theme.accent : theme.dim}>[1] overview</span>
            <span fg={theme.dim}>  </span>
            <span fg={active === "room/projects" ? theme.accent : theme.dim}>[2] projects</span>
            <span fg={theme.dim}>  </span>
            <span fg={active === "room/merges" ? theme.accent : theme.dim}>[3] merges</span>
            <span fg={theme.dim}>  </span>
            <span fg={active === "room/messages" ? theme.accent : theme.dim}>[4] messages</span>
            <span fg={theme.dim}>  </span>
            <span fg={active === "room/outbox" ? theme.accent : theme.dim}>[5] outbox</span>
            <span fg={theme.dim}>  </span>
            <span fg={active === "room/board" ? theme.accent : theme.dim}>[6] board</span>
          </text>
          <text truncate wrapMode="none" flexShrink={1} minWidth={0}>
            <span fg={theme.dim}>  ·  </span>
            <span fg={theme.fg}>{online} online</span>
            {admitted ? null : <span fg={theme.warn}> · waiting for a member to admit you</span>}
          </text>
        </box>
      )}
    </Focusable>
  );
}
