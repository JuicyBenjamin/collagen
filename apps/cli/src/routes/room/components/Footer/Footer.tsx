import { useEffect, useState } from "react";
import { execFile } from "node:child_process";
import { useKeyboard, useRenderer } from "@opentui/react";
import { useAtomValue } from "@effect/atom-react";
import { Option } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { shortRoomId } from "@collagen/p2p";
import { captureAtom, focusAtom, hintsAtom } from "../../../../components/focus";
import { useSession } from "../../../../app/session";
import { theme } from "../../../../app/theme";
import { roomMetaAtom } from "../../../atoms";
import { logsAtom, mcpUrlAtom } from "./atoms";

/** Pinned footer: a fixed 3-line activity log, the MCP url, the room's invite
 *  line (c copies it), and the hovered section's hint. Every line is
 *  single-line on purpose — a wrapped line here changes the footer's height
 *  and reflows the whole screen. */
export function Footer() {
  const { room } = useSession();
  const renderer = useRenderer();
  const focus = useAtomValue(focusAtom);
  const captured = useAtomValue(captureAtom);
  const hints = useAtomValue(hintsAtom);
  const logs = AsyncResult.getOrElse(useAtomValue(logsAtom), () => [] as const);
  const mcpUrl = AsyncResult.getOrElse(useAtomValue(mcpUrlAtom), () => Option.none<string>());
  const roomName = AsyncResult.getOrElse(useAtomValue(roomMetaAtom), () => ({ name: room.name, ts: 0 })).name;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  // OSC 52 puts it on the terminal's clipboard (works over ssh); pbcopy is
  // the local fallback for terminals that block OSC 52.
  useKeyboard((key) => {
    if (captured !== null || key.name !== "c") return;
    renderer.copyToClipboardOSC52(room.id);
    if (process.platform === "darwin") {
      const child = execFile("pbcopy");
      child.stdin?.end(room.id);
    }
    setCopied(true);
  });

  return (
    <>
      <box marginTop={1} flexDirection="column" flexShrink={0}>
        <text fg={theme.dim}>activity</text>
        {[0, 1, 2].map((i) => (
          <text key={i} fg={theme.dim} truncate wrapMode="none">
            {logs.slice(-3)[i] ?? " "}
          </text>
        ))}
      </box>
      <box flexDirection="column" flexShrink={0}>
        <text fg={theme.dim} truncate wrapMode="none">
          mcp: {Option.getOrElse(mcpUrl, () => "starting…")}
        </text>
        <text fg={theme.dim} truncate wrapMode="none">
          room: <span fg={theme.fg}>{roomName}</span> [{shortRoomId(room.id)}] · invite id:{" "}
          <span fg={theme.fg}>{room.id}</span>
          {copied ? <span fg={theme.ok}>  ✓ copied</span> : <span fg={theme.dim}>  (c to copy)</span>}
        </text>
        <text fg={theme.dim} truncate wrapMode="none">
          {captured ?? hints[focus] ?? "esc back to tabs"}
        </text>
      </box>
    </>
  );
}
