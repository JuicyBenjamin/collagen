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

const inTab = (tab: Tab) => (person: Person): boolean => tab === "all" || (tab === "online") === person.online;

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
  const found = selKey === null ? -1 : rows.findIndex((person) => person.key === selKey);
  const sel = found < 0 ? 0 : found;
  const current = rows[sel];
  const at = (index: number) => {
    const person = rows[clamp(index, 0, last)];
    if (person) setSelKey(person.key);
    return true;
  };
  const page = () => Math.max(1, list.current?.view().height ?? 10);
  // the names as one column, as wide as the longest (capped), the rest after it
  const nameWidth = Math.min(NAME_MAX, Math.max(0, ...rows.map((person) => cells(label(person)))));

  return (
    <box flexDirection="column" marginTop={1} flexGrow={1} flexShrink={1} overflow="hidden">
      <Focusable
        id="people-tabs"
        flexShrink={0}
        hint="←→ switch tab · ↓ into the list"
        onKey={(key) => {
          const index = TABS.indexOf(tab);
          if (key.name === "left" && index > 0) return setTab(TABS[index - 1]!), true;
          if (key.name === "right" && index < TABS.length - 1) return setTab(TABS[index + 1]!), true;
          return false;
        }}
      >
        {(focused) => (
          <text wrapMode="none" truncate>
            <span fg={theme.accent}>{focused ? "› " : "  "}</span>
            {TABS.map((tabName, index) => (
              <span key={tabName}>
                {index > 0 ? "   " : ""}
                <span fg={tabName === tab ? (focused ? theme.accent : theme.fg) : theme.dim}>{tabName}</span>
                <span fg={theme.dim}> {people.filter(inTab(tabName)).length}</span>
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
              {rows.map((person) => (
                <PersonRow key={person.key} person={person} selected={focused && person.key === current?.key} nameWidth={nameWidth} />
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

const label = (person: Person): string => (person.you ? `${person.name} (you)` : person.name);
const rowId = (key: string): string => `person-${key}`;
/** Pad to `width` terminal cells, wide characters counted as two. */
const padCells = (text: string, width: number): string => text + " ".repeat(Math.max(0, width - cells(text)));

/** One person: `●` here, `○` away or offline; their name; then quietly their
 *  AI, whether they are away, what stands in the way, their projects here. */
function PersonRow({ person, selected, nameWidth }: { person: Person; selected: boolean; nameWidth: number }) {
  const color = selected ? theme.accent : person.online ? theme.fg : theme.dim;
  const notes = [
    ...(person.ai ? [person.ai] : []),
    ...(person.away ? ["away"] : []),
    ...(person.projects ? [`${person.projects} ${person.projects === 1 ? "project" : "projects"}`] : []),
  ];
  return (
    <box id={rowId(person.key)} flexDirection="row" flexShrink={0}>
      <text fg={color} wrapMode="none" flexShrink={0}>
        {selected ? "› " : "  "}
        <span fg={person.online ? (person.problem ? theme.warn : theme.ok) : theme.dim}>{person.online ? "● " : "○ "}</span>
        {padCells(clip(label(person), nameWidth), nameWidth)}
      </text>
      <text truncate wrapMode="none" flexShrink={1} minWidth={0} marginLeft={2}>
        <span fg={theme.dim}>{notes.join(" · ")}</span>
        {person.problem ? <span fg={theme.warn}>{notes.length > 0 ? " · " : ""}{person.problem}</span> : null}
      </text>
    </box>
  );
}
