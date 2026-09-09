import type { ReactNode } from "react";
import { Logo, Opening } from "../components/Logo/Logo";

/** Root layout: the brand header, then whatever frame is active. `live` once a
 *  session exists: the opening then plays — the logo in the middle of the
 *  screen while the runtime comes up, gliding into the header when it is
 *  there, the app appearing beneath it. The setup page renders inside it
 *  before the app exists, with the still logo — nothing to wait for yet. */
export function RootLayout({ children, live = false }: { children: ReactNode; live?: boolean }) {
  return (
    <box flexDirection="column" padding={1} height="100%">
      {live ? (
        <Opening>{children}</Opening>
      ) : (
        <>
          <Logo />
          {children}
        </>
      )}
    </box>
  );
}
