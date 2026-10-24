import { useAtomSet } from "@effect/atom-react";
import { Focusable } from "../../../../components/Focusable";
import { theme } from "../../../../app/theme";
import { mergesProjectAtom, openMergesPageAtom } from "../atoms";

/** The row of tabs under the merges tab: the projects held here, in the
 *  person's order, the one whose merges are shown bright. ←→ open the next
 *  one's; ↓ into its merges. */
export function Projects({ projects, shown }: { projects: ReadonlyArray<string>; shown: string }) {
  const setProject = useAtomSet(mergesProjectAtom);
  const openPage = useAtomSet(openMergesPageAtom);
  const index = projects.indexOf(shown);
  return (
    <Focusable
      id="merges-projects"
      flexShrink={0}
      hint="←→ switch project · ↓ into the list · o in browser"
      onKey={(key) => {
        if (key.name === "left" && index > 0) return setProject(projects[index - 1]!), true;
        if (key.name === "right" && index < projects.length - 1) return setProject(projects[index + 1]!), true;
        if (key.name === "o") return openPage({}), true;
        return false;
      }}
    >
      {(focused) => (
        <text wrapMode="none" truncate>
          <span fg={theme.accent}>{focused ? "› " : "  "}</span>
          {projects.map((project, position) => (
            <span key={project}>
              {position > 0 ? "   " : ""}
              <span fg={project === shown ? (focused ? theme.accent : theme.fg) : theme.dim}>{project}</span>
            </span>
          ))}
        </text>
      )}
    </Focusable>
  );
}
