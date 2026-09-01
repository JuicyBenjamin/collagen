import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { theme } from "./theme";

/** First-run (and settings) form: display name + room label + room id.
 *  The room id is the invite AND the secret — leave it empty to create a
 *  fresh room (an unguessable uuid v7); paste a friend's id to join theirs.
 *  The label is a local nickname, changeable anytime. */
export function SetupForm({
  initialName,
  initialRoomName,
  initialRoomId,
  title,
  note,
  onDone,
}: {
  initialName: string;
  initialRoomName: string;
  initialRoomId: string;
  title: string;
  note?: string;
  onDone: (values: { name: string; roomName: string; roomId: string }) => void;
}) {
  const [name, setName] = useState(initialName);
  const [roomName, setRoomName] = useState(initialRoomName);
  const [roomId, setRoomId] = useState(initialRoomId);
  const fields = ["name", "roomName", "roomId"] as const;
  const [field, setField] = useState<(typeof fields)[number]>("name");

  const next = () => setField((f) => fields[(fields.indexOf(f) + 1) % fields.length]!);

  const submit = () => {
    if (name.trim().length === 0 || roomName.trim().length === 0) return;
    onDone({ name: name.trim(), roomName: roomName.trim(), roomId: roomId.trim() });
  };

  useKeyboard((key) => {
    if (key.name === "tab") next();
  });

  return (
    <box flexDirection="column" padding={1} gap={1}>
      <ascii-font text="collagen" font="tiny" color={theme.accent} />
      <text fg={theme.fg}>{title}</text>
      <box flexDirection="column" border borderStyle="rounded" borderColor={field === "name" ? theme.accent : theme.dim} paddingX={1} title=" your name ">
        <input focused={field === "name"} value={name} onInput={setName} onSubmit={next} placeholder="how peers see you" />
      </box>
      <box flexDirection="column" border borderStyle="rounded" borderColor={field === "roomName" ? theme.accent : theme.dim} paddingX={1} title=" room label ">
        <input focused={field === "roomName"} value={roomName} onInput={setRoomName} onSubmit={next} placeholder="what YOU call this room — just a nickname" />
      </box>
      <box flexDirection="column" border borderStyle="rounded" borderColor={field === "roomId" ? theme.accent : theme.dim} paddingX={1} title=" room id (the invite) ">
        <input focused={field === "roomId"} value={roomId} onInput={setRoomId} onSubmit={submit} placeholder="paste a friend's room id — or leave empty to create a new room" />
      </box>
      <text fg={theme.dim}>tab switch field · enter next/confirm</text>
      {note ? <text fg={theme.warn}>{note}</text> : null}
    </box>
  );
}
