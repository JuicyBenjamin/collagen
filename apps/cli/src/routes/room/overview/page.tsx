import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { captureAtom } from "../../../components/focus";
import { Help, HELP_HINT } from "./components/Help/Help";
import { Peers } from "./components/Peers/Peers";
import { Tickets } from "./components/Tickets/Tickets";

/** Overview tab: the lists — who's here and what's in flight.
 *  One column: peers, then tickets. Each section owns its keys and its
 *  cursor. Every ticket in the room is here, whoever made it and whoever it
 *  is for; what your agent wants to send is the outbox tab's job, the
 *  projects themselves the projects tab's.
 *
 *  `?` swaps the lists for what their words and marks mean (Help), and takes
 *  the keyboard while it is open, so nothing behind it moves; `?` or esc
 *  brings the lists back where they were. */
export function OverviewPage() {
  const [help, setHelp] = useState(false);
  const captured = useAtomValue(captureAtom);
  const setCaptured = useAtomSet(captureAtom);

  useKeyboard((key) => {
    if (help) {
      if (key.sequence === "?" || key.name === "escape") {
        setHelp(false);
        setCaptured(null);
      }
      return;
    }
    // someone else holds the keyboard (the folder picker): not ours
    if (captured !== null) return;
    if (key.sequence === "?") {
      setHelp(true);
      setCaptured(HELP_HINT);
    }
  });

  if (help) return <Help />;
  return (
    <box flexDirection="column" marginTop={1} flexGrow={1} flexShrink={1}>
      <Peers />
      <Tickets />
    </box>
  );
}
