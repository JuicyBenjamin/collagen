import type { ReactNode } from "react";
import { theme } from "../app/theme";
import { cells } from "../lib/columns";

/** A blank that is drawn: a plain space laid over the border lets its line show through. */
const BLANK = "\u00a0";

/** Rounded, titled panel — opentui boxes have native border titles. */
export function Panel({
  title,
  note,
  color = theme.accent,
  grow = false,
  children,
}: {
  title: string;
  /** what wants the person's eye, on the border after the title */
  note?: string;
  color?: string;
  /** Stretch to absorb the parent's free space (keeps the layout stable). */
  grow?: boolean;
  children: ReactNode;
}) {
  return (
    <box
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={color}
      title={` ${title} `}
      titleColor={color}
      paddingX={1}
      flexGrow={grow ? 1 : 0}
      flexShrink={grow ? 1 : 0}
    >
      {note ? (
        // on the border's own row: the title is one colour, this is another
        <text position="absolute" top={-1} left={cells(title) + 2} fg={theme.warn} wrapMode="none" truncate>
          {` ${note} `.replaceAll(" ", BLANK)}
        </text>
      ) : null}
      {children}
    </box>
  );
}
