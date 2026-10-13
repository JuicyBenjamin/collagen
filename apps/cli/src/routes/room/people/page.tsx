import { useEffect, useRef, useState } from "react";
import { useAtomSet } from "@effect/atom-react";
import { Focusable } from "../../../components/Focusable";
import { FollowScroll, type FollowScrollHandle } from "../../../components/FollowScroll";
import { focusAtom } from "../../../components/focus";
import { theme } from "../../../app/theme";
import { clamp } from "../../../lib/math";
import { cells, clip } from "../../../lib/columns";
import type { Person } from "../../../lib/people";
import { useRoomPeople } from "../overview/components/Peers/Peers";

const TABS = ["all", "online", "offline"] as const;
type Tab = (typeof TABS)[number];

const inTab = (tab: Tab) => (p: Person): boolean => tab === "all" || (tab === "online") === p.online;

/** The people page: everyone the room knows, one row each — here now, away
 *  in another room, or offline — with their AI, what stands in the way of
 *  working with them, and how many projects they share here. Tabs above, as
 *  on the ticket list: ←→ switch, ↓ into the list. */
export function PeoplePage() {
  const people = useRoomPeople();
  const [tab, setTab] = useState<Tab>("all");
  const [selKey, setSelKey] = useState<string | null>(null);
  const list = useRef<FollowScrollHandle>(null);
  // opened from the overview: the cursor lands in the list
  const setFocus = useAtomSet(focusAtom);
  useEffect(() => {
    setFocus("people-list");
  }, [setFocus]);

  const rows = people.filter(inTab(tab));
  const last = Math.max(0, rows.length - 1);
  const found = selKey === null ? -1 : rows.findIndex((p) => p.key === selKey);
  const sel = found < 0 ? 0 : found;
  const current = rows[sel];
  const at = (n: number) => {
    const p = rows[clamp(n, 0, last)];
    if (p) setSelKey(p.key);
    return true;
  };
  const page = () => Math.max(1, list.current?.view().height ?? 10);
  // the names as one column, as wide as the longest (capped), the rest after it
  const nameWidth = Math.min(NAME_MAX, Math.max(0, ...rows.map((p) => cells(label(p)))));

  return (
    <box flexDirection="column" marginTop={1} flexGrow={1} flexShrink={1} overflow="hidden">
      <Focusable
        id="people-tabs"
        flexShrink={0}
        hint="←→ switch tab · ↓ into the list"
        onKey={(key) => {
          const i = TABS.indexOf(tab);
          if (key.name === "left" && i > 0) return setTab(TABS[i - 1]!), true;
          if (key.name === "right" && i < TABS.length - 1) return setTab(TABS[i + 1]!), true;
          return false;
        }}
      >
        {(focused) => (
          <text wrapMode="none" truncate>
            <span fg={theme.accent}>{focused ? "› " : "  "}</span>
            {TABS.map((t, i) => (
              <span key={t}>
                {i > 0 ? "   " : ""}
                <span fg={t === tab ? (focused ? theme.accent : theme.fg) : theme.dim}>{t}</span>
                <span fg={theme.dim}> {people.filter(inTab(t)).length}</span>
              </span>
            ))}
          </text>
        )}
      </Focusable>
      <Focusable
        id="people-list"
        hint="↑↓ select"
        flexDirection="column"
        flexGrow={1}
        flexShrink={1}
        marginTop={1}
        onKey={(key) => {
          if (rows.length === 0) return false;
          if (key.name === "up" && sel > 0) return at(sel - 1);
          if (key.name === "down" && sel < last) return at(sel + 1);
          if (key.name === "pageup") return at(sel - page());
          if (key.name === "pagedown") return at(sel + page());
          if (key.name === "home") return at(0);
          if (key.name === "end") return at(last);
          return false;
        }}
      >
        {(focused) =>
          rows.length === 0 ? (
            <text fg={theme.dim} truncate wrapMode="none">
              {"  "}none
            </text>
          ) : (
            <FollowScroll ref={list} follow={current ? (sel === 0 ? "start" : { id: rowId(current.key) }) : null} flexGrow={1}>
              {rows.map((p) => (
                <PersonRow key={p.key} person={p} selected={focused && p.key === current?.key} nameWidth={nameWidth} />
              ))}
            </FollowScroll>
          )
        }
      </Focusable>
    </box>
  );
}

/** The most a name takes before the rest of its row. */
const NAME_MAX = 24;

const label = (p: Person): string => (p.you ? `${p.name} (you)` : p.name);
const rowId = (key: string): string => `person-${key}`;
/** Pad to `width` terminal cells, wide characters counted as two. */
const padCells = (text: string, width: number): string => text + " ".repeat(Math.max(0, width - cells(text)));

/** One person: `●` here, `○` away or offline; their name; then quietly their
 *  AI, whether they are away, what stands in the way, their projects here. */
function PersonRow({ person: p, selected, nameWidth }: { person: Person; selected: boolean; nameWidth: number }) {
  const fg = selected ? theme.accent : p.online ? theme.fg : theme.dim;
  const notes = [
    ...(p.ai ? [p.ai] : []),
    ...(p.away ? ["away"] : []),
    ...(p.projects ? [`${p.projects} ${p.projects === 1 ? "project" : "projects"}`] : []),
  ];
  return (
    <box id={rowId(p.key)} flexDirection="row" flexShrink={0}>
      <text fg={fg} wrapMode="none" flexShrink={0}>
        {selected ? "› " : "  "}
        <span fg={p.online ? (p.problem ? theme.warn : theme.ok) : theme.dim}>{p.online ? "● " : "○ "}</span>
        {padCells(clip(label(p), nameWidth), nameWidth)}
      </text>
      <text truncate wrapMode="none" flexShrink={1} minWidth={0} marginLeft={2}>
        <span fg={theme.dim}>{notes.join(" · ")}</span>
        {p.problem ? <span fg={theme.warn}>{notes.length > 0 ? " · " : ""}{p.problem}</span> : null}
      </text>
    </box>
  );
}
