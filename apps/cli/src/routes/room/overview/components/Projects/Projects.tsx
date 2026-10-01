import { useState } from "react";
import { homedir } from "node:os";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
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
import { sharedProject } from "../../../../../lib/projects";
import { projectRows } from "../../../projectRows";

/** Projects sidebar — a section, one row per PROJECT with who shares it.
 *  Two different actions, kept apart in the words: a project peers share
 *  that is not on this machine yet is a dim row of its own, and enter on it
 *  LOCATES your copy — the folder picker, and the folder is registered under
 *  the project's shared name whatever it is called here, so one project
 *  stays one row. "+ add project" is for a folder nobody in the room shares.
 *  The picker captures the keyboard; d removes one of yours. Projects
 *  belong to the room they were added in (Keet-style). */
export function Projects() {
  const roomId = AsyncResult.getOrElse(useAtomValue(roomAtom), () => ({ id: "", name: "" })).id;
  const state = AsyncResult.getOrElse(useAtomValue(stateAtom), () => ({ preferredAi: null, rooms: {} }));
  const peers = AsyncResult.getOrElse(useAtomValue(rosterAtom), () => [] as const);
  const updateState = useAtomSet(updateStateAtom);
  const setCaptured = useAtomSet(captureAtom);
  const [cursor, setCursor] = useState(0);
  // null: not picking; { as: undefined }: adding a new project (named by its
  // folder); { as: name }: locating your copy of a project peers share
  const [picking, setPicking] = useState<{ readonly as?: string } | null>(null);

  const rows = projectRows(state, roomId, peers);
  // the last row is always "+ add project", so adding is arrows + enter
  const last = rows.length;
  const sel = clamp(cursor, 0, last);

  const startPicking = (as?: string) => {
    setPicking(as === undefined ? {} : { as });
    setCaptured(FS_PICKER_HINT);
  };
  const stopPicking = () => {
    setPicking(null);
    setCaptured(null);
  };
  const addFolder = (folder: string, path: string) => {
    // a located copy keeps the shared name; a folder whose name a peer's
    // project already has is that project too, in the room's spelling
    const name = picking?.as ?? sharedProject(folder, peers)?.name ?? folder;
    updateState({
      update: (s) => {
        const here = s.rooms[roomId] ?? [];
        if (here.some((p) => p.path === path || p.name === name)) return s;
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
      hint={rows[sel] && !rows[sel]!.mine ? "↑↓ select · enter point collagen at your copy · arrows move between sections · esc" : "↑↓ select · enter add a project nobody shares · d remove yours · arrows move between sections · esc"}
      flexDirection="column"
      width={34}
      flexShrink={0}
      onKey={(key) => {
        if (key.name === "up" && sel > 0) return setCursor(sel - 1), true;
        if (key.name === "down" && sel < last) return setCursor(sel + 1), true;
        if (isEnter(key) && sel === rows.length) return startPicking(), true;
        const row = rows[sel];
        // a project peers share that you have not located here: find your copy
        if (isEnter(key) && row && !row.mine) return startPicking(row.name), true;
        // only your own projects can be removed
        if (key.name === "d" && row?.mine) return remove(row.mine.id), true;
        return false;
      }}
    >
      {(focused) => (
        <Panel title={picking?.as ? `your copy of ${picking.as}` : picking ? "pick a folder" : "projects"} color={focused || picking ? theme.accent : theme.dim} grow>
          {picking ? (
            <FsPicker start={homedir()} onPick={addFolder} onCancel={stopPicking} />
          ) : (
            <box flexDirection="column">
              {rows.map((row, i) => {
                const shared = row.holders.length >= 2;
                const selected = focused && i === sel;
                // not on this machine: dim, and it says so — the needed action
                // is visible before anyone presses anything
                const missing = row.mine === undefined;
                return (
                  <box key={row.name} flexDirection="column" flexShrink={0}>
                    <text fg={selected ? theme.accent : shared && !missing ? theme.fg : theme.dim} truncate wrapMode="none">
                      {selected ? "› " : "  "}
                      {row.name}
                      <span fg={theme.dim}> — {row.holders.join(", ")}</span>
                    </text>
                    {missing ? (
                      <text fg={selected ? theme.accent : theme.dim} truncate wrapMode="none">
                        {"    "}not here yet{selected ? " · enter: your copy" : ""}
                      </text>
                    ) : null}
                  </box>
                );
              })}
              <text fg={focused && sel === rows.length ? theme.accent : theme.dim} truncate wrapMode="none">
                {focused && sel === rows.length ? "› " : "  "}+ add a project nobody shares
              </text>
            </box>
          )}
        </Panel>
      )}
    </Focusable>
  );
}
