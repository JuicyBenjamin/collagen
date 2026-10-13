import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { Focusable } from "../../../../../components/Focusable";
import { isEnter } from "../../../../../components/keys";
import { theme } from "../../../../../app/theme";
import { to, useRouter } from "../../../../../app/router";
import { fitNames, roomPeople, type Person } from "../../../../../lib/people";
import { myNameAtom, roomAtom } from "../../../../atoms";
import { aiStatusAtom, identityAtom, membersAtom, rosterAtom, stateAtom } from "../../../atoms";

/** Who is in the room, in two lines that never grow: `●` everyone here now,
 *  you first; `○` everyone else — away in another room, or offline. A line
 *  too long for the pane ends in `…`. A name in the warning colour has a
 *  problem (its AI's CLI, its sign-in, another collagen version). enter
 *  opens the people page, where each is a row with the rest. */
export function Peers() {
  const { navigate } = useRouter();
  const people = useRoomPeople();
  const [width, setWidth] = useState<number | undefined>(undefined);
  const here = people.filter((p) => p.online);
  const rest = people.filter((p) => !p.online);

  return (
    <Focusable
      id="people"
      hint="enter people · arrows move between sections"
      // never squeezed by the list below it: a shrunk box draws its lines over each other
      flexShrink={0}
      onKey={(key) => {
        if (isEnter(key)) return navigate(to.people("room/overview")), true;
        return false;
      }}
    >
      {(focused) => (
        <box
          flexDirection="column"
          onSizeChange={function (this: { width: number }) {
            if (this.width !== width) setWidth(this.width);
          }}
        >
          <NamesLine mark="●" markColor={theme.ok} people={here} width={width} cursor={focused} />
          <NamesLine mark="○" markColor={theme.dim} people={rest} width={width} cursor={false} />
        </box>
      )}
    </Focusable>
  );
}

/** The room's people as the overview and the people page read them. */
export function useRoomPeople(): ReadonlyArray<Person> {
  const myName = AsyncResult.getOrElse(useAtomValue(myNameAtom), () => "…");
  const me = AsyncResult.getOrElse(useAtomValue(identityAtom), () => null)?.pubkey ?? "";
  const state = useAtomValue(stateAtom);
  const ai = AsyncResult.getOrElse(state, () => ({ preferredAi: null })).preferredAi;
  const roomId = AsyncResult.getOrElse(useAtomValue(roomAtom), () => ({ id: "", name: "" })).id;
  const projects = AsyncResult.isSuccess(state) ? (state.value.rooms[roomId] ?? []).length : 0;
  const aiStatus = AsyncResult.getOrElse(useAtomValue(aiStatusAtom), () => "unknown" as const);
  const roster = AsyncResult.getOrElse(useAtomValue(rosterAtom), () => [] as const);
  const members = AsyncResult.getOrElse(useAtomValue(membersAtom), () => [] as const);
  return roomPeople({ key: me, name: myName, ai, aiStatus, projects }, roster, members);
}

/** One line of names after its mark, as many as fit, then `…`. */
function NamesLine({ mark, markColor, people, width, cursor }: { mark: string; markColor: string; people: ReadonlyArray<Person>; width: number | undefined; cursor: boolean }) {
  const names = people.map((p) => (p.you ? "you" : p.name));
  // the cursor, the mark and a space before the names
  const fit = width === undefined ? { shown: names.length, more: false } : fitNames(names, Math.max(1, width - 4));
  return (
    <text truncate wrapMode="none">
      <span fg={theme.accent}>{cursor ? "› " : "  "}</span>
      <span fg={markColor}>{mark} </span>
      {people.length === 0 ? <span fg={theme.dim}>none</span> : null}
      {people.slice(0, fit.shown).map((p, i) => (
        <span key={p.key} fg={p.problem ? theme.warn : p.online ? theme.fg : theme.dim}>
          {i > 0 ? ", " : ""}
          {names[i]}
        </span>
      ))}
      {fit.more ? <span fg={theme.dim}> …</span> : null}
    </text>
  );
}
