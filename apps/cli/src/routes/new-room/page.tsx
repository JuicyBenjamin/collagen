import { useAtomSet } from "@effect/atom-react";
import { invitedRoomEntry, newRoomEntry } from "../../config/profileFile";
import { useRouter } from "../../app/router";
import { RoomChooser } from "../components/RoomChooser/RoomChooser";
import { joinRoomAtom } from "./atoms";

/** The sidebar's +: join or create another room while the app runs. The new
 *  room opens and becomes the one you're looking at; the others stay live. */
export function NewRoomPage() {
  const { navigate } = useRouter();
  const joinRoom = useAtomSet(joinRoomAtom);

  return (
    <box flexDirection="column" gap={1} marginTop={1}>
      <RoomChooser
        title="join or create a room"
        onDone={(choice) => {
          joinRoom({ entry: choice.mode === "create" ? newRoomEntry(choice.name) : invitedRoomEntry(choice.inviteId) });
          navigate("room/overview");
        }}
        onCancel={() => navigate("room/overview")}
      />
    </box>
  );
}
