import { Peers } from "./components/Peers/Peers";
import { Projects } from "./components/Projects/Projects";
import { Tickets } from "./components/Tickets/Tickets";

/** Overview tab: what a person cares about — who's here, what's in flight,
 *  what's shared. Two columns: peers + tickets on the left, projects sidebar
 *  on the right. Each section owns its keys and its cursor. */
export function OverviewPage() {
  return (
    <box flexDirection="row" gap={2} marginTop={1} flexGrow={1} flexShrink={1}>
      <box flexDirection="column" flexGrow={1} flexShrink={1}>
        <Peers />
        <Tickets />
      </box>
      <Projects />
    </box>
  );
}
