import { theme } from "../../../../../../app/theme";
import { clip } from "../../../../../../lib/columns";
import type { HostMerge } from "../../../../../../services/RepoHost";

/** The cursor's columns, before every row. */
export const CURSOR = 4;
/** Between the title and the info. */
export const GAP = 2;

/** A merge: its pull request's title (its branch, when it has none), then
 *  its number, branch and how long ago, dim. */
export function Merge({ id, merge, info, selected, lead, infoWidth }: { id: string; merge: HostMerge; info: string; selected: boolean; lead: number; infoWidth: number }) {
  const color = selected ? theme.accent : theme.fg;
  return (
    <box id={id} flexDirection="row" flexShrink={0}>
      <text fg={color} wrapMode="none" flexShrink={0}>
        {selected ? "  › " : "    "}
      </text>
      <text fg={color} truncate wrapMode="none" flexBasis={lead} flexShrink={1} minWidth={0}>
        {merge.title || merge.branch}
      </text>
      {infoWidth > 0 ? (
        <text fg={theme.dim} wrapMode="none" flexBasis={infoWidth} flexShrink={0} marginLeft={GAP}>
          {clip(info, infoWidth)}
        </text>
      ) : null}
    </box>
  );
}
