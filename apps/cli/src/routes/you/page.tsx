import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { writeProfileFile } from "../../config/profileFile";
import { useRouter } from "../../app/router";
import { useSession } from "../../app/session";
import { theme } from "../../app/theme";
import { shownAi } from "../../lib/jobs";
import { myNameAtom } from "../atoms";
import { identityAtom, stateAtom } from "../room/atoms";
import { setMyNameAtom } from "./atoms";

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

  const save = () => {
    const next = name.trim();
    if (next.length === 0) return;
    writeProfileFile(profile, { name: next });
    if (next !== myName) setMyName({ name: next });
    setSaved(true);
  };

  useKeyboard((key) => {
    if (key.name === "escape") navigate("room/overview");
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
      <text fg={saved ? theme.ok : theme.dim}>{saved ? "saved" : "enter saves · esc back"}</text>
    </box>
  );
}
