import { useEffect, type ReactNode } from "react";
import { useKeyboard } from "@opentui/react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { AI_OPTIONS } from "@collagen/p2p";
import { MOCK_AI_OPTIONS } from "../../services/Adapters";
import { Panel } from "../../components/Panel";
import { captureAtom, focusAtom } from "../../components/focus";
import { keyDebug } from "../../components/keys";
import { useRouter } from "../../app/router";
import { useSession } from "../../app/session";
import { roomMetaAtom } from "../atoms";
import { updateStateAtom } from "./atoms";
import { Footer } from "./components/Footer/Footer";
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

/** Room layout: status line · the room panel (tab bar + the active tab as
 *  children) · footer. Owns the global accelerators; each section is a
 *  Focusable that owns its own keys. The room IS the container — it absorbs
 *  all free vertical space so the footer stays pinned and resizes don't reflow. */
export function RoomLayout({ children, onExit }: { children: ReactNode; onExit: () => void }) {
  const { room } = useSession();
  const { navigate } = useRouter();
  const { jump } = useTabs();
  const setFocus = useAtomSet(focusAtom);
  const captured = useAtomValue(captureAtom) !== null;
  const roomName = AsyncResult.getOrElse(useAtomValue(roomMetaAtom), () => ({ name: room.name, ts: 0 })).name;
  const updateState = useAtomSet(updateStateAtom);

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
    if (key.name === "1") return jump("room/overview");
    if (key.name === "2") return jump("room/messages");
    if (key.name === "escape") return setFocus("tabs");
  });

  return (
    <>
      <StatusLine />
      <box marginTop={1} flexDirection="column" flexGrow={1} flexShrink={1}>
        <Panel title={`room · ${roomName}`} grow>
          <TabBar />
          {children}
        </Panel>
      </box>
      <Footer />
    </>
  );
}
