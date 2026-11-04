import { useState } from "react";
import { homedir } from "node:os";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { newProject } from "@collagen/p2p";
import { Focusable } from "../../../components/Focusable";
import { FS_PICKER_HINT, FsPicker } from "../../../components/FsPicker";
import { Panel } from "../../../components/Panel";
import { captureAtom } from "../../../components/focus";
import { isEnter } from "../../../components/keys";
import { theme } from "../../../app/theme";
import { clamp } from "../../../lib/math";
import { roomAtom } from "../../atoms";
import { notesAtom, noteTurnsAtom, rosterAtom, stateAtom, updateStateAtom } from "../atoms";
import { notesOf } from "../../../lib/steeringNotes";
import { sharedProject } from "../../../lib/projects";
import { withProjectOrder } from "../../../lib/projectOrder";
import { projectRows } from "../projectRows";

/** Projects tab — one row per PROJECT with who shares it. Out of the
 *  overview so the lists there stay about the work; each person's line there
 *  carries only a count. Two different actions, kept apart in the words: a
 *  project peers share that is not on this machine yet is a dim row of its
 *  own, and enter on it LOCATES your copy — the folder picker, and the folder
 *  is registered under the project's shared name whatever it is called here,
 *  so one project stays one row. "+ add project" is for a folder nobody in
 *  the room shares. The picker captures the keyboard; d removes one of yours;
 *  shift ↑↓ moves a project, in the order kept on this machine alone.
 *  Projects belong to the room they were added in (Keet-style). */
export function ProjectsPage() {
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
  const notes = AsyncResult.getOrElse(useAtomValue(notesAtom), () => [] as const);
  const noteTurns = AsyncResult.getOrElse(useAtomValue(noteTurnsAtom), () => [] as const);
  // the last row is always "+ add project", so adding is arrows + enter
  const last = rows.length;
  const sel = clamp(cursor, 0, last);
  // the hint names only what the row under the cursor does
  const current = rows[sel];
  const action = current === undefined ? "enter add a project" : current.mine ? "d remove" : "enter point collagen at your copy";

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
      update: (previous) => {
        const here = previous.rooms[roomId] ?? [];
        if (here.some((project) => project.path === path || project.name === name)) return previous;
        return { ...previous, rooms: { ...previous.rooms, [roomId]: [...here, newProject(name, path)] } };
      },
    });
    stopPicking();
  };
  // the row under the cursor swaps with its neighbour, and the cursor goes with it
  const move = (by: -1 | 1) => {
    const names = rows.map((row) => row.name);
    [names[sel], names[sel + by]] = [names[sel + by]!, names[sel]!];
    updateState({ update: (previous) => withProjectOrder(previous, roomId, names) });
    setCursor(sel + by);
  };
  const remove = (id: string) =>
    updateState({
      update: (previous) => ({ ...previous, rooms: { ...previous.rooms, [roomId]: (previous.rooms[roomId] ?? []).filter((project) => project.id !== id) } }),
    });

  return (
    <Focusable
      id="projects"
      hint={`↑↓ select${current ? " · shift ↑↓ move" : ""} · ${action} · arrows move between sections · esc`}
      flexDirection="column"
      marginTop={1}
      flexGrow={1}
      flexShrink={1}
      onKey={(key) => {
        if (key.shift && (key.name === "up" || key.name === "down")) {
          const by = key.name === "up" ? -1 : 1;
          // the first project goes no higher, the last no lower, "+ add project" nowhere
          if (sel < rows.length && sel + by >= 0 && sel + by < rows.length) move(by);
          return true;
        }
        if (key.name === "up" && sel > 0) return setCursor(sel - 1), true;
        if (key.name === "down" && sel < last) return setCursor(sel + 1), true;
        if (isEnter(key) && sel === rows.length) return startPicking(), true;
        // a project peers share that you have not located here: find your copy
        if (isEnter(key) && current && !current.mine) return startPicking(current.name), true;
        // only your own projects can be removed
        if (key.name === "d" && current?.mine) return remove(current.mine.id), true;
        return false;
      }}
    >
      {(focused) =>
        picking ? (
          <Panel title={picking.as ? `your copy of ${picking.as}` : "pick a folder"} color={theme.accent} grow>
            <FsPicker start={homedir()} onPick={addFolder} onCancel={stopPicking} />
          </Panel>
        ) : (
          // idle: a borderless list like the overview's; the tab names it
          <box flexDirection="column">
            {/* empty: what a project is, plainly, rather than "none" */}
            {rows.length === 0 ? (
              // padded, not spaced: a narrow terminal wraps it, every line under the first
              <box paddingLeft={2}>
                <text fg={theme.dim} wrapMode="word">
                  No projects yet: add a folder of code you work on, and its reviews and merges are read from your copy.
                </text>
              </box>
            ) : null}
            {rows.map((row, index) => {
              const selected = focused && index === sel;
              // not on this machine: dim, and it says so — the needed action
              // is visible before anyone presses anything
              const missing = row.mine === undefined;
              return (
                <box key={row.name} flexDirection="column" flexShrink={0}>
                  {/* yours reads plainly whether anyone else shares it; only one not on this machine is dim */}
                  <text fg={selected ? theme.accent : missing ? theme.dim : theme.fg} truncate wrapMode="none">
                    {selected ? "› " : "  "}
                    {row.name}
                    <span fg={theme.dim}> · shared by {row.holders.join(", ")}</span>
                  </text>
                  {missing ? (
                    <text fg={selected ? theme.accent : theme.dim} truncate wrapMode="none">
                      {"    "}not here yet
                    </text>
                  ) : null}
                  {/* the project under the cursor: how the room steers its AIs there */}
                  {selected
                    ? notesOf(notes, noteTurns, row.name)
                        .filter((note) => !note.retired)
                        .map((note) => (
                          <text key={note.note.id} fg={theme.dim} truncate wrapMode="none">
                            {"    "}
                            {note.words.title}
                            {note.words.strength ? <span fg={theme.dim}> · {note.words.strength}</span> : null}
                          </text>
                        ))
                    : null}
                </box>
              );
            })}
            <text fg={focused && sel === rows.length ? theme.accent : theme.dim} truncate wrapMode="none">
              {focused && sel === rows.length ? "› " : "  "}+ add project
            </text>
          </box>
        )
      }
    </Focusable>
  );
}
