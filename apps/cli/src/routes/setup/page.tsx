import { useState } from "react";
import { theme } from "../../app/theme";
import { RoomChooser, type RoomChoice } from "../components/RoomChooser/RoomChooser";

/** What the first-run wizard produces. */
export interface SetupResult {
  name: string;
  room: RoomChoice;
}

/** First-run frame: who are you, then join-or-create. Runs BEFORE the
 *  runtime exists, so it touches no atoms. */
export function SetupPage({ initialName, onDone }: { initialName: string; onDone: (values: SetupResult) => void }) {
  const [name, setName] = useState(initialName);
  const [named, setNamed] = useState(false);

  const submitName = () => {
    if (name.trim().length === 0) return;
    setNamed(true);
  };

  return (
    <box flexDirection="column" gap={1} marginTop={1}>
      {named ? (
        <RoomChooser
          title="step 2 of 2 — join or create a room?"
          onDone={(room) => onDone({ name: name.trim(), room })}
          onCancel={() => setNamed(false)}
        />
      ) : (
        <>
          <text fg={theme.fg}>step 1 of 2 — who are you?</text>
          <box border borderStyle="rounded" borderColor={theme.accent} paddingX={1} title=" your name ">
            <input focused value={name} onInput={setName} onSubmit={submitName} placeholder="how peers see you" />
          </box>
          <text fg={theme.dim}>enter continue</text>
        </>
      )}
    </box>
  );
}
