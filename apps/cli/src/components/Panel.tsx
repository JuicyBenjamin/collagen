import type { ReactNode } from "react";
import { theme } from "../app/theme";

/** Rounded, titled panel — opentui boxes have native border titles. */
export function Panel({
  title,
  color = theme.accent,
  grow = false,
  children,
}: {
  title: string;
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
      {children}
    </box>
  );
}
