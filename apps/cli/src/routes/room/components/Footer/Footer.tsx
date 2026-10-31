import { useEffect, useState } from "react";
import { execFile } from "node:child_process";
import { useKeyboard, useRenderer } from "@opentui/react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import { shortRoomId } from "@collagen/p2p";
import { captureAtom } from "../../../../components/focus";
import { theme } from "../../../../app/theme";
import { IS_RELEASE, VERSION } from "../../../../app/version";
import { roomAtom } from "../../../atoms";
import { inviteAtom, logsAtom, mcpUrlAtom } from "./atoms";

/** Pinned footer: a fixed 3-line activity log, the MCP url, the room's line
 *  (c makes an invite and copies it). Every line is single-line on purpose — a wrapped line
 *  here changes the footer's height and reflows the whole screen. The key
 *  legend lives inside the room panel (Keys), next to what it describes. */
export function Footer() {
  const room = AsyncResult.getOrElse(useAtomValue(roomAtom), () => ({ id: "", name: "…" }));
  const renderer = useRenderer();
  const captured = useAtomValue(captureAtom);
  const logs = AsyncResult.getOrElse(useAtomValue(logsAtom), () => [] as const);
  const mcpUrl = AsyncResult.getOrElse(useAtomValue(mcpUrlAtom), () => Option.none<string>());
  const [copied, setCopied] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const makeInvite = useAtomSet(inviteAtom, { mode: "promise" });

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  // c makes a new invite (one person, within a week) and copies it. OSC 52
  // puts it on the terminal's clipboard (works over ssh); pbcopy is the local
  // fallback for terminals that block OSC 52.
  useKeyboard((key) => {
    if (captured !== null || key.name !== "c") return;
    void makeInvite().then((made) => {
      if ("why" in made) return setRefused(made.why);
      renderer.copyToClipboardOSC52(made.invite);
      if (process.platform === "darwin") {
        const child = execFile("pbcopy");
        child.stdin?.end(made.invite);
      }
      setRefused(null);
      setCopied(true);
    });
  });

  return (
    <>
      <box marginTop={1} flexDirection="column" flexShrink={0}>
        <text fg={theme.dim}>activity</text>
        {[0, 1, 2].map((index) => (
          <text key={index} fg={theme.dim} truncate wrapMode="none">
            {logs.slice(-3)[index] ?? " "}
          </text>
        ))}
      </box>
      <box flexDirection="column" flexShrink={0}>
        <text fg={theme.dim} truncate wrapMode="none">
          collagen {VERSION}{IS_RELEASE ? "" : " · devnet"} · mcp: {Option.getOrElse(mcpUrl, () => "starting…")}
        </text>
        <text fg={theme.dim} truncate wrapMode="none">
          room: <span fg={theme.fg}>{room.name}</span> [{shortRoomId(room.id)}] ·{" "}
          {copied ? <span fg={theme.ok}>invite copied — it lets one person in, within a week</span> : refused ? <span fg={theme.warn}>no invite: {refused}</span> : <span fg={theme.dim}>c copies an invite</span>}
        </text>
      </box>
    </>
  );
}
