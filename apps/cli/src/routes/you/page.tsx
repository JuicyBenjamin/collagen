import { execFile } from "node:child_process";
import { useState } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { writeProfileFile } from "../../config/profileFile";
import { useRouter } from "../../app/router";
import { useSession } from "../../app/session";
import { theme } from "../../app/theme";
import { shownAi } from "../../lib/jobs";
import { myNameAtom } from "../atoms";
import { identityAtom, stateAtom } from "../room/atoms";
import { deviceCodeAtom, devicesAtom, setMyNameAtom } from "./atoms";

/** Who you are to the rooms: your name (applied on enter), your key, and the
 *  AI they see you use — the one you use most, not one you pick. */
export function YouPage() {
  const { profile } = useSession();
  const { navigate } = useRouter();
  const myName = AsyncResult.getOrElse(useAtomValue(myNameAtom), () => "");
  const identity = AsyncResult.getOrElse(useAtomValue(identityAtom), () => null);
  const state = AsyncResult.getOrElse(useAtomValue(stateAtom), () => null);
  const setMyName = useAtomSet(setMyNameAtom);
  const [name, setName] = useState(myName);
  const [saved, setSaved] = useState(false);
  const ai = state ? shownAi(state) : null;
  const renderer = useRenderer();
  const mine = AsyncResult.getOrElse(useAtomValue(devicesAtom), () => null);
  const makeCode = useAtomSet(deviceCodeAtom, { mode: "promise" });
  /** what ctrl+d last did: a code copied, or why there is none */
  const [code, setCode] = useState<{ readonly copied: true } | { readonly why: string } | null>(null);

  const save = () => {
    const next = name.trim();
    if (next.length === 0) return;
    writeProfileFile(profile, { name: next });
    if (next !== myName) setMyName({ name: next });
    setSaved(true);
  };

  useKeyboard((key) => {
    if (key.name === "escape") navigate("room/overview");
    // a device code for another machine of yours, on the clipboard as an invite is (OSC 52, pbcopy beside it)
    if (key.ctrl && key.name === "d")
      void makeCode().then((made) => {
        if ("why" in made) return setCode(made);
        renderer.copyToClipboardOSC52(made.code);
        if (process.platform === "darwin") execFile("pbcopy").stdin?.end(made.code);
        setCode({ copied: true });
      });
  });

  return (
    <box flexDirection="column" gap={1} marginTop={1}>
      <text fg={theme.fg}>you</text>
      <box flexDirection="column" border borderStyle="rounded" borderColor={theme.accent} paddingX={1} title=" your name ">
        <input focused value={name} onInput={(typed) => (setName(typed), setSaved(false))} onSubmit={save} placeholder="how the rooms see you" />
      </box>
      <box flexDirection="column" paddingX={1}>
        <text fg={theme.dim}>
          key <span fg={theme.fg}>{identity ? `${identity.pubkey.slice(0, 16)}…` : "…"}</span>
        </text>
        <text fg={theme.dim}>
          {ai ? "the rooms see you use " : "the rooms see you use no AI yet"}
          {ai ? <span fg={theme.fg}>{ai}</span> : null}
          {ai ? ", the one your conversations work in most" : ""}
        </text>
      </box>
      <box flexDirection="column" paddingX={1}>
        <text fg={theme.dim}>your devices</text>
        {(mine?.devices ?? []).map((device) => (
          <text key={device.key} fg={theme.fg}>
            {device.name || device.key.slice(0, 8)}
            <span fg={theme.dim}>
              {device.key === mine?.device ? " · this one" : ""}
              {device.key === mine?.parent ? " · parent" : ""}
            </span>
          </text>
        ))}
        <text fg={code && "copied" in code ? theme.ok : code ? theme.warn : theme.dim}>
          {code && "copied" in code ? "device code copied — on the other machine: collagen connect-device <code>, within ten minutes" : code ? `no device code: ${code.why}` : "ctrl+d copies a device code for another machine"}
        </text>
      </box>
      <text fg={saved ? theme.ok : theme.dim}>{saved ? "saved" : "enter saves · esc back"}</text>
    </box>
  );
}
