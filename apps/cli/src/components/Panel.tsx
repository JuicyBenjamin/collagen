import type { ReactNode } from "react";
import { theme } from "../app/theme";

/** More line than any terminal is wide: the top edge is cut to the panel. */
const LINE = "─".repeat(600);

/** Rounded, titled panel. Its top edge is a row of its own, not the box's
 *  border: the title in the panel's colour and, after it, a note in the warn
 *  colour — what wants the person's eye. (Laid over the native border the
 *  note came and went: the border is repainted on its own, over whatever
 *  sits on it.) */
export function Panel({
  title,
  note,
  color = theme.accent,
  grow = false,
  children,
}: {
  title: string;
  /** what wants the person's eye, on the top edge after the title */
  note?: string;
  color?: string;
  /** Stretch to absorb the parent's free space (keeps the layout stable). */
  grow?: boolean;
  children: ReactNode;
}) {
  return (
    <box flexDirection="column" flexGrow={grow ? 1 : 0} flexShrink={grow ? 1 : 0}>
      <box flexDirection="row" flexShrink={0} height={1}>
        {/* the title gives way before the note does */}
        <text fg={color} wrapMode="none" truncate flexShrink={1} minWidth={0}>
          {`╭─ ${title} `}
        </text>
        {note ? (
          <text fg={theme.warn} wrapMode="none" flexShrink={0}>
            {`${note} `}
          </text>
        ) : null}
        <box flexGrow={1} flexShrink={1} flexBasis={0} minWidth={0} height={1} overflow="hidden">
          <text fg={color} wrapMode="none">
            {LINE}
          </text>
        </box>
        <text fg={color} wrapMode="none" flexShrink={0}>
          ╮
        </text>
      </box>
      <box flexDirection="column" border={["left", "right", "bottom"]} borderStyle="rounded" borderColor={color} paddingX={1} flexGrow={grow ? 1 : 0} flexShrink={grow ? 1 : 0}>
        {children}
      </box>
    </box>
  );
}
