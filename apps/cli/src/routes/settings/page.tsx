import { formatInvite } from "@collagen/p2p";
import { NET } from "../../app/net";
import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { writeProfileFile } from "../../config/profileFile";
import { useRouter } from "../../app/router";
import { useSession } from "../../app/session";
import { theme } from "../../app/theme";
import { SETTINGS, settingOf, withSetting, type SettingKey } from "../../lib/settings";
import { myNameAtom, roomAtom } from "../atoms";
import { stateAtom, updateStateAtom } from "../room/atoms";
import { renameRoomAtom, setMyNameAtom } from "./atoms";

type Field = "name" | "room" | SettingKey;
const FIELDS: ReadonlyArray<Field> = ["name", "room", ...SETTINGS.map((setting) => setting.key)];

/** Settings frame: your name + the room's shared name, both applied on
 *  enter, then your switches, each applied the moment it is flipped (your
 *  agent can flip them for you too — set-settings). The room id is shown
 *  for reference only — it's the invite, never editable. */
export function SettingsPage() {
  const { profile } = useSession();
  const room = AsyncResult.getOrElse(useAtomValue(roomAtom), () => ({ id: "", name: "" }));
  const { navigate } = useRouter();
  const myName = AsyncResult.getOrElse(useAtomValue(myNameAtom), () => "");
  const roomName = room.name;
  const setMyName = useAtomSet(setMyNameAtom);
  const renameRoom = useAtomSet(renameRoomAtom);

  const [name, setName] = useState(myName);
  const [label, setLabel] = useState(roomName);
  const [field, setField] = useState<Field>("name");
  const [saved, setSaved] = useState(false);
  const state = AsyncResult.getOrElse(useAtomValue(stateAtom), () => null);
  const updateState = useAtomSet(updateStateAtom);
  const flip = (key: SettingKey) => updateState({ update: (previous) => withSetting(previous, key, !settingOf(previous, key)) });

  const next = () => setField((current) => FIELDS[(FIELDS.indexOf(current) + 1) % FIELDS.length]!);
  const prev = () => setField((current) => FIELDS[(FIELDS.indexOf(current) + FIELDS.length - 1) % FIELDS.length]!);
  const submit = () => {
    const newName = name.trim();
    const newRoomName = label.trim();
    if (newName.length === 0 || newRoomName.length === 0) return;
    writeProfileFile(profile, { name: newName });
    if (newName !== myName) setMyName({ name: newName });
    // renaming is shared state — broadcast to the whole room
    if (newRoomName !== roomName) renameRoom({ name: newRoomName });
    setSaved(true);
  };

  useKeyboard((key) => {
    if (key.name === "tab") return key.shift ? prev() : next();
    if (key.name === "escape") return navigate("room/overview");
    // on a switch (not typing in a field): arrows move, space or enter flips
    if (field === "name" || field === "room") return;
    if (key.name === "down") return next();
    if (key.name === "up") return prev();
    if (key.name === "space" || key.name === "return" || key.name === "enter") return flip(field);
  });

  return (
    <box flexDirection="column" gap={1} marginTop={1}>
      <text fg={theme.fg}>settings — profile "{profile}"</text>
      <box flexDirection="column" border borderStyle="rounded" borderColor={field === "name" ? theme.accent : theme.dim} paddingX={1} title=" your name ">
        <input focused={field === "name"} value={name} onInput={setName} onSubmit={next} placeholder="how peers see you" />
      </box>
      <box
        flexDirection="column"
        border
        borderStyle="rounded"
        borderColor={field === "room" ? theme.accent : theme.dim}
        paddingX={1}
        title=" room name (shared with everyone) "
      >
        <input focused={field === "room"} value={label} onInput={setLabel} onSubmit={submit} placeholder="renames the room for the whole room" />
      </box>
      <box flexDirection="column" border borderStyle="rounded" borderColor={SETTINGS.some((setting) => setting.key === field) ? theme.accent : theme.dim} paddingX={1} title=" switches ">
        {SETTINGS.map((setting) => {
          const on = state ? settingOf(state, setting.key) : setting.default;
          const here = field === setting.key;
          return (
            <box key={setting.key} flexDirection="column">
              <text fg={here ? theme.accent : theme.fg}>
                {here ? "› " : "  "}
                {on ? "[on] " : "[off]"} {setting.label}
              </text>
              <text fg={theme.dim}>{`        ${on ? setting.on : setting.off}`}</text>
            </box>
          );
        })}
      </box>
      <text fg={theme.dim} truncate wrapMode="none">
        invite id: <span fg={theme.fg}>{formatInvite(room.id, NET)}</span> (fixed — press c in the room to copy)
      </text>
      <text fg={theme.dim}>tab next field · enter next/confirm · on a switch: space flips it</text>
      <text fg={theme.warn}>{saved ? "saved — applies now" : "changes apply live · esc back"}</text>
    </box>
  );
}
