import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { isRoomId } from "@collagen/p2p";
import { isEnter } from "../../../components/keys";
import { theme } from "../../../app/theme";

/** What the chooser produces: a room to create (named by you) or one to
 *  join (its invite id). Turning that into a room entry is the caller's job. */
export type RoomChoice = { mode: "create"; name: string } | { mode: "join"; inviteId: string };

type Step = "choice" | "create" | "join";

/** "Join or create a room?" — one question per screen, so joining a friend's
 *  room and creating a fresh one are explicit, separate paths: you can't end
 *  up in a new room by accident when you meant to paste an invite. Used by
 *  first-run setup and by the sidebar's +. Touches no atoms (setup runs
 *  before the runtime exists). */
export function RoomChooser({
  title,
  onDone,
  onCancel,
}: {
  title: string;
  onDone: (choice: RoomChoice) => void;
  /** esc on the question itself. */
  onCancel: () => void;
}) {
  const [step, setStep] = useState<Step>("choice");
  const [choice, setChoice] = useState(0); // 0 create · 1 join
  const [roomName, setRoomName] = useState("");
  const [inviteId, setInviteId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submitCreate = () => {
    if (roomName.trim().length === 0) return;
    onDone({ mode: "create", name: roomName.trim() });
  };
  const submitJoin = () => {
    const id = inviteId.trim();
    if (!isRoomId(id)) {
      setError("that doesn't look like a room id — it should be a uuid like 019904c3-…-…");
      return;
    }
    onDone({ mode: "join", inviteId: id });
  };

  useKeyboard((key) => {
    if (step === "choice") {
      if (["up", "down", "left", "right"].includes(key.name)) return setChoice((c) => (c === 0 ? 1 : 0));
      if (isEnter(key)) return setStep(choice === 0 ? "create" : "join");
      if (key.name === "escape") return onCancel();
      return;
    }
    if (key.name === "escape") {
      setError(null);
      setStep("choice");
    }
  });

  return (
    <>
      {step === "choice" ? (
        <>
          <text fg={theme.fg}>{title}</text>
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
              value={inviteId}
              onInput={(v: string) => {
                setError(null);
                setInviteId(v);
              }}
              onSubmit={submitJoin}
              placeholder="paste the invite id your friend copied with c"
            />
          </box>
          {error ? <text fg={theme.warn}>{error}</text> : null}
          <text fg={theme.dim}>enter join · esc back</text>
        </>
      ) : null}
    </>
  );
}
