import type { ReactNode } from "react";
import { theme } from "../app/theme";

/** Root layout: the brand header, then whatever frame is active. Needs no
 *  runtime — the setup page renders inside it before the app exists. */
export function RootLayout({ children }: { children: ReactNode }) {
  return (
    <box flexDirection="column" padding={1} height="100%">
      <ascii-font text="collagen" font="tiny" color={theme.accent} />
      <text fg={theme.dim}>peer-to-peer</text>
      {children}
    </box>
  );
}
