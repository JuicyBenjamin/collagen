import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import type { LocalState } from "@collagen/p2p";
import { theme } from "../../../app/theme";
import { inProjectOrder, projectOrderOf } from "../../../lib/projectOrder";
import { sameName } from "../../../lib/names";
import { roomAtom } from "../../atoms";
import { stateAtom } from "../atoms";
import { mergesProjectAtom } from "./atoms";
import { List } from "./components/List";
import { Projects } from "./components/Projects";

/** The merges tab: one project's merges at a time, under a row of tabs of
 *  the projects held here in the person's order — the first one's when the
 *  tab opens, another's read when its tab is opened. */
export function MergesPage() {
  const roomId = AsyncResult.getOrElse(useAtomValue(roomAtom), () => ({ id: "", name: "" })).id;
  const state = AsyncResult.getOrElse(useAtomValue(stateAtom), (): LocalState => ({ preferredAi: null, rooms: {} }));
  const chosen = useAtomValue(mergesProjectAtom);
  const projects = inProjectOrder(state.rooms[roomId] ?? [], (project) => project.name, projectOrderOf(state, roomId)).map((project) => project.name);
  // the one chosen while it is still here, else the first
  const shown = projects.find((project) => chosen !== null && sameName(project, chosen)) ?? projects[0];

  return (
    <box flexDirection="column" marginTop={1} flexGrow={1} flexShrink={1} overflow="hidden">
      {shown === undefined ? (
        <text fg={theme.dim} truncate wrapMode="none">
          {"  "}no projects here
        </text>
      ) : (
        <>
          <Projects projects={projects} shown={shown} />
          <List key={shown} project={shown} />
        </>
      )}
    </box>
  );
}
