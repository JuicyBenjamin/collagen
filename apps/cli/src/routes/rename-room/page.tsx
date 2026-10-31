import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { useRouter } from "../../app/router";
import { theme } from "../../app/theme";
import { roomAtom } from "../atoms";
import { renameRoomAtom } from "./atoms";

/** The room's name, shared with everyone in it: r on the rooms rail. */
export function RenameRoomPage() {
  const { navigate } = useRouter();
  const room = AsyncResult.getOrElse(useAtomValue(roomAtom), () => ({ id: "", name: "" }));
  const renameRoom = useAtomSet(renameRoomAtom);
  const [name, setName] = useState(room.name);

  useKeyboard((key) => {
    if (key.name === "escape") navigate("room/overview");
  });

  return (
    <box flexDirection="column" gap={1} marginTop={1}>
      <box flexDirection="column" border borderStyle="rounded" borderColor={theme.accent} paddingX={1} title=" room name — everyone in it sees it ">
        <input
          focused
          value={name}
          onInput={setName}
          onSubmit={() => {
            const next = name.trim();
            if (next.length > 0 && next !== room.name) renameRoom({ name: next });
            navigate("room/overview");
          }}
        />
      </box>
      <text fg={theme.dim}>enter renames · esc back</text>
    </box>
  );
}
