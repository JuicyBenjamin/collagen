import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { isRoomInviteId } from "../util";
import { isEnter } from "./components";
import { theme } from "./theme";

/** What the first-run wizard produces. `roomId` is only set when joining;
 *  creating leaves id generation (uuid v7) to the caller. */
export interface SetupResult {
  name: string;
  mode: "create" | "join";
  roomName: string;
  roomId: string;
}

type Step = "name" | "choice" | "create" | "join";

/** First-run wizard. One question per screen so joining a friend's room and
 *  creating a fresh one are explicit, separate paths — you can't end up in a
 *  new room by accident when you meant to paste an invite. */
export function SetupWizard({
  initialName,
  onDone,
}: {
  initialName: string;
  onDone: (values: SetupResult) => void;
}) {
  const [step, setStep] = useState<Step>("name");
  const [name, setName] = useState(initialName);
  const [choice, setChoice] = useState(0); // 0 create · 1 join
  const [roomName, setRoomName] = useState("");
  const [roomId, setRoomId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submitName = () => {
    if (name.trim().length === 0) return;
    setStep("choice");
  };

  const submitCreate = () => {
    if (roomName.trim().length === 0) return;
    onDone({ name: name.trim(), mode: "create", roomName: roomName.trim(), roomId: "" });
  };

  const submitJoin = () => {
    const id = roomId.trim();
    if (!isRoomInviteId(id)) {
      setError("that doesn't look like a room id — it should be a uuid like 019904c3-…-…");
      return;
    }
    onDone({ name: name.trim(), mode: "join", roomName: "", roomId: id });
  };

  useKeyboard((key) => {
    if (step === "choice") {
      if (key.name === "up" || key.name === "down" || key.name === "left" || key.name === "right")
        return setChoice((c) => (c === 0 ? 1 : 0));
      if (isEnter(key)) return setStep(choice === 0 ? "create" : "join");
      if (key.name === "escape") return setStep("name");
      return;
    }
    if ((step === "create" || step === "join") && key.name === "escape") {
      setError(null);
      return setStep("choice");
    }
  });

  return (
    <box flexDirection="column" padding={1} gap={1}>
      <ascii-font text="collagen" font="tiny" color={theme.accent} />

      {step === "name" ? (
        <>
          <text fg={theme.fg}>step 1 of 2 — who are you?</text>
          <box border borderStyle="rounded" borderColor={theme.accent} paddingX={1} title=" your name ">
            <input focused value={name} onInput={setName} onSubmit={submitName} placeholder="how peers see you" />
          </box>
          <text fg={theme.dim}>enter continue</text>
        </>
      ) : null}

      {step === "choice" ? (
        <>
          <text fg={theme.fg}>step 2 of 2 — join or create a room?</text>
          <box flexDirection="column">
            <text fg={choice === 0 ? theme.accent : theme.fg}>{choice === 0 ? "› " : "  "}create a new room</text>
            <text fg={theme.dim}>    start fresh — you get an invite id to share with friends</text>
            <text fg={choice === 1 ? theme.accent : theme.fg}>{choice === 1 ? "› " : "  "}join a friend's room</text>
            <text fg={theme.dim}>    paste the invite id they sent you</text>
          </box>
          <text fg={theme.dim}>↑↓ select · enter confirm · esc back</text>
        </>
      ) : null}

      {step === "create" ? (
        <>
          <text fg={theme.fg}>create a room</text>
          <box border borderStyle="rounded" borderColor={theme.accent} paddingX={1} title=" room name ">
            <input focused value={roomName} onInput={setRoomName} onSubmit={submitCreate} placeholder="what to call it — changeable anytime" />
          </box>
          <text fg={theme.dim}>enter create · esc back</text>
        </>
      ) : null}

      {step === "join" ? (
        <>
          <text fg={theme.fg}>join a room</text>
          <box border borderStyle="rounded" borderColor={theme.accent} paddingX={1} title=" invite id ">
            <input
              focused
              value={roomId}
              onInput={(v: string) => {
                setError(null);
                setRoomId(v);
              }}
              onSubmit={submitJoin}
              placeholder="paste the invite id your friend copied with c"
            />
          </box>
          {error ? <text fg={theme.warn}>{error}</text> : null}
          <text fg={theme.dim}>enter join · esc back</text>
        </>
      ) : null}
    </box>
  );
}

/** Settings form: your name + the room's shared name. Both apply live. The
 *  room id is shown for reference only — it's the invite, never editable. */
export function SetupForm({
  initialName,
  initialRoomName,
  roomId,
  title,
  note,
  onDone,
}: {
  initialName: string;
  initialRoomName: string;
  roomId: string;
  title: string;
  note?: string;
  onDone: (values: { name: string; roomName: string }) => void;
}) {
  const [name, setName] = useState(initialName);
  const [roomName, setRoomName] = useState(initialRoomName);
  const fields = ["name", "roomName"] as const;
  const [field, setField] = useState<(typeof fields)[number]>("name");

  const next = () => setField((f) => fields[(fields.indexOf(f) + 1) % fields.length]!);

  const submit = () => {
    if (name.trim().length === 0 || roomName.trim().length === 0) return;
    onDone({ name: name.trim(), roomName: roomName.trim() });
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
      <box flexDirection="column" border borderStyle="rounded" borderColor={field === "roomName" ? theme.accent : theme.dim} paddingX={1} title=" room name (shared with everyone) ">
        <input focused={field === "roomName"} value={roomName} onInput={setRoomName} onSubmit={submit} placeholder="renames the room for the whole room" />
      </box>
      <text fg={theme.dim}>
        invite id: <span fg={theme.fg}>{roomId}</span> (fixed — press c in the room to copy)
      </text>
      <text fg={theme.dim}>tab switch field · enter next/confirm</text>
      {note ? <text fg={theme.warn}>{note}</text> : null}
    </box>
  );
}
