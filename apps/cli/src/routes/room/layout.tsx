import { useEffect, type ReactNode } from "react";
import { useKeyboard } from "@opentui/react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { AI_OPTIONS } from "@collagen/p2p";
import { MOCK_AI_OPTIONS } from "../../services/Adapters";
import { RESTART_EXIT_CODE } from "../../services/Updates";
import { Panel } from "../../components/Panel";
import { captureAtom, focusAtom, leftEdgeAtom } from "../../components/focus";
import { keyDebug } from "../../components/keys";
import { useRouter, type Route } from "../../app/router";
import { roomAtom } from "../atoms";
import { installAppUpdateAtom, updateStateAtom } from "./atoms";
import { ticketsAtom } from "./overview/components/Tickets/atoms";
import { Crumb } from "./components/Crumb/Crumb";
import { Footer } from "./components/Footer/Footer";
import { Keys } from "./components/Keys/Keys";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { StatusLine } from "./components/StatusLine/StatusLine";
import { TabBar } from "./components/TabBar/TabBar";
import { useTabs } from "./tabs";

function nextAi(current: string | null): string | null {
  // null -> claude-code -> codex -> mock:claude-code -> mock:codex -> null …
  // the mocks let a machine without an LLM CLI participate; the mock: prefix
  // is broadcast so peers see there's no real AI behind it.
  const cycle: (string | null)[] = [null, ...AI_OPTIONS, ...MOCK_AI_OPTIONS];
  const i = cycle.indexOf(current);
  return cycle[(i + 1) % cycle.length] ?? null;
}

/** Room layout: status line · the rooms sidebar beside the room panel (tab
 *  bar + the active tab as children) · footer. Owns
 *  the global accelerators; each section is a Focusable that owns its own
 *  keys. The room IS the container — it absorbs all free vertical space so
 *  the footer stays pinned and resizes don't reflow. */
export function RoomLayout({ children, onExit }: { children: ReactNode; onExit: (code?: number) => void }) {
  const { route, navigate } = useRouter();
  // a ticket is a page of its own inside the room: crumb instead of tabs
  const page = typeof route === "object" ? route : null;
  const tickets = AsyncResult.getOrElse(useAtomValue(ticketsAtom), () => [] as const);
  const goalOf = (ticketId: string) => tickets.find((t) => t.id === ticketId)?.goal ?? `ticket ${ticketId.slice(0, 8)}`;
  // what the crumb says, and where esc / ← go from here
  // the trail of names above a route: overview › ticket › transcripts › …
  const trailOf = (r: Route): ReadonlyArray<string> =>
    typeof r === "string"
      ? ["overview"]
      : r.name === "room/ticket"
        ? [...trailOf("room/overview"), goalOf(r.ticketId)]
        : r.name === "room/transcripts"
          ? [...trailOf(r.back), "transcripts"]
          : r.name === "room/attach"
            ? [...trailOf(r.back), "attach"]
            : r.name === "room/review"
              ? [...trailOf(r.back), "why"]
              : [...trailOf(r.back), r.file];
  const crumb =
    page === null
      ? null
      : page.name === "room/ticket"
        ? { trail: ["overview"], label: goalOf(page.ticketId), back: "room/overview" as const, focus: "tickets" }
        : page.name === "room/transcripts"
          ? { trail: trailOf(page.back), label: "transcripts", back: page.back, focus: typeof page.back === "object" ? "ticket-diagnostics" : "tickets" }
          : page.name === "room/attach"
            ? { trail: trailOf(page.back), label: "attach", back: page.back, focus: "ticket-diagnostics" }
            : page.name === "room/review"
              ? { trail: trailOf(page.back), label: "why", back: page.back, focus: "ticket-review" }
              : { trail: trailOf(page.back), label: page.file, back: page.back, focus: "transcript-files" };
  const goBack = () => {
    if (!crumb) return;
    navigate(crumb.back);
    setFocus(crumb.focus);
  };
  // on a page, ← past the left edge is back; on the tabs it reaches the rail as before
  const setLeftEdge = useAtomSet(leftEdgeAtom);
  useEffect(() => {
    setLeftEdge(crumb ? () => goBack : null);
    return () => setLeftEdge(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on where we are
  }, [setLeftEdge, page?.name, page && "ticketId" in page ? page.ticketId : "", page && "subject" in page ? page.subject : "", page && "path" in page ? page.path : "", page?.name === "room/attach" || page?.name === "room/review" ? page.ticketId : ""]);
  const { jump } = useTabs();
  const setFocus = useAtomSet(focusAtom);
  const captured = useAtomValue(captureAtom) !== null;
  const roomName = AsyncResult.getOrElse(useAtomValue(roomAtom), () => ({ id: "", name: "…" })).name;
  const updateState = useAtomSet(updateStateAtom);
  const installUpdate = useAtomSet(installAppUpdateAtom);
  const installed = useAtomValue(installAppUpdateAtom);

  // an update was installed: hand the terminal back and let the bin shim
  // start the new version in our place
  useEffect(() => {
    if (AsyncResult.isSuccess(installed) && installed.value === true) onExit(RESTART_EXIT_CODE);
  }, [installed, onExit]);

  // the cursor starts on the tab bar whenever the room frame appears
  useEffect(() => {
    setFocus("tabs");
  }, [setFocus]);

  // Global accelerators: work wherever the cursor is, unless a section has
  // captured the keyboard (folder picker).
  useKeyboard((key) => {
    keyDebug("room", key, captured ? "captured" : undefined);
    if (captured) return;
    if (key.name === "q") return onExit();
    if (key.name === "a") return updateState({ update: (s) => ({ ...s, preferredAi: nextAi(s.preferredAi) }) });
    if (key.name === "s") return navigate("settings");
    if (key.name === "u") return installUpdate({});
    if (key.name === "1") return jump("room/overview");
    if (key.name === "2") return jump("room/messages");
    if (key.name === "escape") {
      // inside a page (ticket, transcripts), esc is "back"; on a tab, back to the tab bar
      if (crumb) return goBack();
      return setFocus("tabs");
    }
  });

  return (
    <>
      <StatusLine />
      <box flexDirection="row" marginTop={1} flexGrow={1} flexShrink={1}>
        <Sidebar />
        <Panel title={crumb ? `room · ${roomName} › ${page?.name === "room/ticket" ? "ticket" : page?.name === "room/transcripts" ? "transcripts" : page?.name === "room/attach" ? "attach" : page?.name === "room/review" ? "why" : "transcript"}` : `room · ${roomName}`} grow>
          {crumb ? <Crumb trail={crumb.trail} label={crumb.label} onBack={goBack} /> : <TabBar />}
          {children}
          <Keys />
        </Panel>
      </box>
      <Footer />
    </>
  );
}
