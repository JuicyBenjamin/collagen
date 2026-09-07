import { useState } from "react";
import { homedir } from "node:os";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { newProject } from "@collagen/p2p";
import { Focusable } from "../../../../../components/Focusable";
import { FS_PICKER_HINT, FsPicker } from "../../../../../components/FsPicker";
import { Panel } from "../../../../../components/Panel";
import { captureAtom } from "../../../../../components/focus";
import { isEnter } from "../../../../../components/keys";
import { theme } from "../../../../../app/theme";
import { clamp } from "../../../../../lib/math";
import { roomAtom } from "../../../../atoms";
import { rosterAtom, stateAtom, updateStateAtom } from "../../../atoms";
import { projectRows } from "../../../projectRows";

/** Projects sidebar — a section: ↑↓ select, enter on "+ add" opens the folder
 *  picker (which captures the keyboard), d removes one of yours. Projects
 *  belong to the room they were added in (Keet-style). */
export function Projects() {
  const roomId = AsyncResult.getOrElse(useAtomValue(roomAtom), () => ({ id: "", name: "" })).id;
  const state = AsyncResult.getOrElse(useAtomValue(stateAtom), () => ({ preferredAi: null, rooms: {} }));
  const peers = AsyncResult.getOrElse(useAtomValue(rosterAtom), () => [] as const);
  const updateState = useAtomSet(updateStateAtom);
  const setCaptured = useAtomSet(captureAtom);
  const [cursor, setCursor] = useState(0);
  const [picking, setPicking] = useState(false);

  const rows = projectRows(state, roomId, peers);
  // the last row is always "+ add project", so adding is arrows + enter
  const last = rows.length;
  const sel = clamp(cursor, 0, last);

  const startPicking = () => {
    setPicking(true);
    setCaptured(FS_PICKER_HINT);
  };
  const stopPicking = () => {
    setPicking(false);
    setCaptured(null);
  };
  const addFolder = (name: string, path: string) => {
    updateState({
      update: (s) => {
        const here = s.rooms[roomId] ?? [];
        if (here.some((p) => p.path === path)) return s;
        return { ...s, rooms: { ...s.rooms, [roomId]: [...here, newProject(name, path)] } };
      },
    });
    stopPicking();
  };
  const remove = (id: string) =>
    updateState({
      update: (s) => ({ ...s, rooms: { ...s.rooms, [roomId]: (s.rooms[roomId] ?? []).filter((p) => p.id !== id) } }),
    });

  return (
    <Focusable
      id="projects"
      hint="↑↓ select · enter add · d remove yours · arrows move between sections · esc"
      flexDirection="column"
      width={34}
      flexShrink={0}
      onKey={(key) => {
        if (key.name === "up" && sel > 0) return setCursor(sel - 1), true;
        if (key.name === "down" && sel < last) return setCursor(sel + 1), true;
        if (isEnter(key) && sel === rows.length) return startPicking(), true;
        const row = rows[sel];
        // only your own projects can be removed
        if (key.name === "d" && row?.mine) return remove(row.mine.id), true;
        return false;
      }}
    >
      {(focused) => (
        <Panel title={picking ? "pick a folder" : "projects"} color={focused || picking ? theme.accent : theme.dim} grow>
          {picking ? (
            <FsPicker start={homedir()} onPick={addFolder} onCancel={stopPicking} />
          ) : (
            <box flexDirection="column">
              {rows.map((row, i) => {
                const shared = row.holders.length >= 2;
                const selected = focused && i === sel;
                return (
                  <text key={row.name} fg={selected ? theme.accent : shared ? theme.fg : theme.dim} truncate wrapMode="none">
                    {selected ? "› " : "  "}
                    {row.name}
                    <span fg={theme.dim}> — {row.holders.join(", ")}</span>
                  </text>
                );
              })}
              <text fg={focused && sel === rows.length ? theme.accent : theme.dim} truncate wrapMode="none">
                {focused && sel === rows.length ? "› " : "  "}+ add project
              </text>
            </box>
          )}
        </Panel>
      )}
    </Focusable>
  );
}
