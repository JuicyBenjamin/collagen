import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { theme } from "./theme";

/** First-run (and settings) form: display name + room. Room doubles as the
 *  shared secret — everyone using the same room name meets. */
export function SetupForm({
  initialName,
  initialRoom,
  title,
  note,
  onDone,
}: {
  initialName: string;
  initialRoom: string;
  title: string;
  note?: string;
  onDone: (name: string, room: string) => void;
}) {
  const [name, setName] = useState(initialName);
  const [room, setRoom] = useState(initialRoom);
  const [field, setField] = useState<"name" | "room">("name");

  const submit = () => {
    if (name.trim().length === 0 || room.trim().length === 0) return;
    onDone(name.trim(), room.trim());
  };

  useKeyboard((key) => {
    if (key.name === "tab") setField((f) => (f === "name" ? "room" : "name"));
  });

  return (
    <box flexDirection="column" padding={1} gap={1}>
      <ascii-font text="collagen" font="tiny" color={theme.accent} />
      <text fg={theme.fg}>{title}</text>
      <box flexDirection="column" border borderStyle="rounded" borderColor={theme.accent} paddingX={1} title=" your name ">
        <input
          focused={field === "name"}
          value={name}
          onInput={setName}
          onSubmit={() => setField("room")}
          placeholder="how peers see you"
        />
      </box>
      <box flexDirection="column" border borderStyle="rounded" borderColor={theme.accent} paddingX={1} title=" room ">
        <input
          focused={field === "room"}
          value={room}
          onInput={setRoom}
          onSubmit={submit}
          placeholder="shared secret — same name = same room"
        />
      </box>
      <text fg={theme.dim}>tab switch field · enter next/confirm</text>
      {note ? <text fg={theme.warn}>{note}</text> : null}
    </box>
  );
}
