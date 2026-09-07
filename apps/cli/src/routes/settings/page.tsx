import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { writeProfileFile } from "../../config/profileFile";
import { useRouter } from "../../app/router";
import { useSession } from "../../app/session";
import { theme } from "../../app/theme";
import { myNameAtom, roomMetaAtom } from "../atoms";
import { renameRoomAtom, setMyNameAtom } from "./atoms";

/** Settings frame: your name + the room's shared name, both applied live.
 *  The room id is shown for reference only — it's the invite, never editable. */
export function SettingsPage() {
  const { profile, room } = useSession();
  const { navigate } = useRouter();
  const myName = AsyncResult.getOrElse(useAtomValue(myNameAtom), () => "");
  const roomName = AsyncResult.getOrElse(useAtomValue(roomMetaAtom), () => ({ name: room.name, ts: 0 })).name;
  const setMyName = useAtomSet(setMyNameAtom);
  const renameRoom = useAtomSet(renameRoomAtom);

  const [name, setName] = useState(myName);
  const [label, setLabel] = useState(roomName);
  const [field, setField] = useState<"name" | "room">("name");
  const [saved, setSaved] = useState(false);

  const next = () => setField((f) => (f === "name" ? "room" : "name"));
  const submit = () => {
    const n = name.trim();
    const r = label.trim();
    if (n.length === 0 || r.length === 0) return;
    writeProfileFile(profile, { name: n });
    if (n !== myName) setMyName({ name: n });
    // renaming is shared state — broadcast to the whole room
    if (r !== roomName) renameRoom({ name: r });
    setSaved(true);
  };

  useKeyboard((key) => {
    if (key.name === "tab") return next();
    if (key.name === "escape") return navigate("room/overview");
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
      <text fg={theme.dim} truncate wrapMode="none">
        invite id: <span fg={theme.fg}>{room.id}</span> (fixed — press c in the room to copy)
      </text>
      <text fg={theme.dim}>tab switch field · enter next/confirm</text>
      <text fg={theme.warn}>{saved ? "saved — applies now" : "changes apply live · esc back"}</text>
    </box>
  );
}
