import { useState } from "react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import type { RoomSummary } from "../../../../services/Rooms";
import { Focusable } from "../../../../components/Focusable";
import { isEnter, isSpace } from "../../../../components/keys";
import { theme } from "../../../../app/theme";
import { useRouter } from "../../../../app/router";
import { clamp } from "../../../../lib/math";
import { initials } from "./initials";
import { focusRoomAtom, leaveRoomAtom, roomSummariesAtom } from "./atoms";

/** Rooms sidebar — Discord's server rail: one avatar per room (its initials
 *  in a rounded box) and a + at the bottom to join or create another. The
 *  room you're looking at carries a tall pill on its left; a dot there marks
 *  messages waiting for you in a room you're not looking at; the bubble in
 *  the avatar's bottom-right corner counts the people online there. You are
 *  only present in one room at a time — the others stay connected and keep
 *  receiving. Hovering the rail expands it so names show next to the
 *  avatars; ↑↓ pick, enter switches (or opens the + flow), → goes back into
 *  the room. */
export function Sidebar() {
  const rooms = AsyncResult.getOrElse(useAtomValue(roomSummariesAtom), () => [] as ReadonlyArray<RoomSummary>);
  const focusRoom = useAtomSet(focusRoomAtom);
  const leaveRoom = useAtomSet(leaveRoomAtom);
  const { navigate } = useRouter();
  // null = the cursor rests on the room you're in until you move it
  const [cursor, setCursor] = useState<number | null>(null);

  // the last row is always +, so joining is arrows + enter
  const last = rooms.length;
  const sel = clamp(cursor ?? Math.max(0, rooms.findIndex((r) => r.focused)), 0, last);

  return (
    <Focusable
      id="rooms"
      hint="↑↓ pick room · enter look at it · d leave · + join or create · → into the room · esc"
      flexDirection="column"
      flexShrink={0}
      marginRight={1}
      onKey={(key) => {
        if (key.name === "up" && sel > 0) return setCursor(sel - 1), true;
        if (key.name === "down" && sel < last) return setCursor(sel + 1), true;
        // the rail is the left edge: nowhere to go
        if (key.name === "up" || key.name === "down" || key.name === "left") return true;
        if (key.name === "d") {
          const room = rooms[sel];
          if (room) leaveRoom({ id: room.id });
          return true;
        }
        if (isEnter(key) || isSpace(key)) {
          const room = rooms[sel];
          if (room) {
            if (!room.focused) focusRoom({ id: room.id });
          } else navigate("new-room");
          return true;
        }
        return false;
      }}
    >
      {(hovered) => (
        <>
          {rooms.map((room, i) => (
            <Avatar
              key={room.id}
              text={initials(room.name)}
              label={room.name}
              current={room.focused}
              selected={hovered && i === sel}
              expanded={hovered}
              online={room.online}
              unread={room.unread > 0}
            />
          ))}
          <Avatar text="+ " label="new room" selected={hovered && sel === last} expanded={hovered} />
        </>
      )}
    </Focusable>
  );
}

/** One rail entry, drawn as three rows: a 6-cell rounded "circle" holding
 *  two cells of text, the presence column to its left (▌ pill = the room you
 *  are in, ● = unread elsewhere), the online count set into the bottom-right
 *  corner, and — when expanded — the name to the right. */
function Avatar({
  text,
  label,
  current = false,
  selected,
  expanded,
  online = 0,
  unread = false,
}: {
  text: string;
  label: string;
  current?: boolean;
  selected: boolean;
  expanded: boolean;
  online?: number;
  unread?: boolean;
}) {
  const border = selected ? theme.fg : current ? theme.accent : theme.dim;
  const fg = selected || current ? theme.fg : theme.dim;
  const pill = current ? "▌" : " ";
  const count = online > 9 ? "9+" : online > 0 ? String(online) : "";
  const bottom = count.length === 0 ? "────" : count.length === 1 ? "──" : "─";
  return (
    <box flexDirection="row" alignItems="center">
      <box flexDirection="column">
        <text fg={border} wrapMode="none">
          <span fg={theme.accent}>{pill}</span>
          {"╭────╮"}
        </text>
        <text fg={border} wrapMode="none">
          <span fg={unread && !current ? theme.warn : theme.accent}>{unread && !current ? "●" : pill}</span>
          {"│ "}
          <span fg={fg}>{text}</span>
          {" │"}
        </text>
        <text fg={border} wrapMode="none">
          <span fg={theme.accent}>{pill}</span>
          {`╰${bottom}`}
          {count.length > 0 ? <span fg={theme.ok}>{count}</span> : null}
          {count.length > 0 ? "─╯" : "╯"}
        </text>
      </box>
      {expanded ? (
        <box width={16} marginLeft={1}>
          <text fg={fg} truncate wrapMode="none">
            {label}
          </text>
        </box>
      ) : null}
    </box>
  );
}
