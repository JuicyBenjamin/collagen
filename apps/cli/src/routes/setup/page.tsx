import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { isRoomId } from "@collagen/p2p";
import { isEnter } from "../../components/keys";
import { theme } from "../../app/theme";

/** What the first-run wizard produces. `roomId` is only set when joining;
 *  creating leaves id generation (uuid v7) to the caller. */
export interface SetupResult {
  name: string;
  mode: "create" | "join";
  roomName: string;
  roomId: string;
}

type Step = "name" | "choice" | "create" | "join";

/** First-run frame. One question per screen so joining a friend's room and
 *  creating a fresh one are explicit, separate paths — you can't end up in a
 *  new room by accident when you meant to paste an invite. Runs BEFORE the
 *  runtime exists, so it touches no atoms. */
export function SetupPage({ initialName, onDone }: { initialName: string; onDone: (values: SetupResult) => void }) {
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
    if (!isRoomId(id)) {
      setError("that doesn't look like a room id — it should be a uuid like 019904c3-…-…");
      return;
    }
    onDone({ name: name.trim(), mode: "join", roomName: "", roomId: id });
  };

  useKeyboard((key) => {
    if (step === "choice") {
      if (["up", "down", "left", "right"].includes(key.name)) return setChoice((c) => (c === 0 ? 1 : 0));
      if (isEnter(key)) return setStep(choice === 0 ? "create" : "join");
      if (key.name === "escape") return setStep("name");
      return;
    }
    if ((step === "create" || step === "join") && key.name === "escape") {
      setError(null);
      setStep("choice");
    }
  });

  return (
    <box flexDirection="column" gap={1} marginTop={1}>
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
