import { useAtomValue } from "@effect/atom-react";
import { theme } from "../../../app/theme";
import { mergesShownAtom } from "./atoms";
import { List } from "./components/List";
import { Projects } from "./components/Projects";

/** The merges tab: one project's merges at a time, under a row of tabs of
 *  the projects held here in the person's order — the first one's when the
 *  tab opens, another's read when its tab is opened. */
export function MergesPage() {
  const { projects, shown } = useAtomValue(mergesShownAtom);

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
