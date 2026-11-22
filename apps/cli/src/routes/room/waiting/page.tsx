import { useEffect, useState } from "react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { Focusable } from "../../../components/Focusable";
import { FollowScroll } from "../../../components/FollowScroll";
import { focusAtom } from "../../../components/focus";
import { isEnter } from "../../../components/keys";
import { theme } from "../../../app/theme";
import { cells, clip } from "../../../lib/columns";
import type { Waiter } from "../../../lib/roomHealth";
import { dateTimeOf } from "../../../lib/when";
import { standingAtom } from "../atoms";
import { letInAtom, turnAwayAtom } from "./atoms";

/** Who wants into the room: those whose invite waits on a yes, then those
 *  on the room with no invite. enter lets the one under the cursor in; t
 *  turns away one who asked with an invite. Someone at the door is handed
 *  an invite and comes in with it, so there is nothing to turn away. */
export function WaitingPage() {
  const standing = AsyncResult.getOrElse(useAtomValue(standingAtom), () => null);
  const waiters = standing?.waiters ?? [];
  const mayLetIn = standing?.mayLetIn ?? false;
  const [selKey, setSelKey] = useState<string | null>(null);
  const [said, setSaid] = useState<{ readonly text: string; readonly ok: boolean } | null>(null);
  const letIn = useAtomSet(letInAtom, { mode: "promise" });
  const turnAway = useAtomSet(turnAwayAtom, { mode: "promise" });
  const setFocus = useAtomSet(focusAtom);
  useEffect(() => {
    setFocus("waiting-list");
  }, [setFocus]);

  const found = waiters.findIndex((waiter) => waiter.key === selKey);
  const sel = found < 0 ? 0 : found;
  const current = waiters[sel];
  const nameWidth = Math.min(NAME_MAX, Math.max(0, ...waiters.map((waiter) => cells(waiter.name))));
  const answer = (waiter: Waiter, act: typeof letIn, done: string) =>
    void act({ waiter }).then((refused) => setSaid(refused === null ? { text: `${waiter.name} ${done}`, ok: true } : { text: `${waiter.name}: ${refused}`, ok: false }));

  return (
    <box flexDirection="column" marginTop={1} flexGrow={1} flexShrink={1} overflow="hidden">
      <Focusable
        id="waiting-list"
        hint={mayLetIn ? "↑↓ select · enter let in · t turn away" : "↑↓ select"}
        flexDirection="column"
        flexGrow={1}
        flexShrink={1}
        onKey={(key) => {
          if (!current) return false;
          if (key.name === "up" && sel > 0) return setSelKey(waiters[sel - 1]!.key), true;
          if (key.name === "down" && sel < waiters.length - 1) return setSelKey(waiters[sel + 1]!.key), true;
          if (!mayLetIn) return false;
          if (isEnter(key)) return answer(current, letIn, current.at === null ? "is handed an invite" : "is let in"), true;
          if (key.name === "t" && current.at !== null) return answer(current, turnAway, "is turned away"), true;
          return false;
        }}
      >
        {(focused) =>
          waiters.length === 0 ? (
            <text fg={theme.dim} truncate wrapMode="none">
              {"  "}nobody is waiting
            </text>
          ) : (
            <FollowScroll follow={current ? (sel === 0 ? "start" : { id: rowId(current.key) }) : null} flexGrow={1}>
              {waiters.map((waiter) => (
                <WaiterRow key={waiter.key} waiter={waiter} selected={focused && waiter.key === current?.key} nameWidth={nameWidth} />
              ))}
            </FollowScroll>
          )
        }
      </Focusable>
      {said ? (
        <text fg={said.ok ? theme.ok : theme.warn} truncate wrapMode="none" flexShrink={0}>
          {"  "}
          {said.text}
        </text>
      ) : waiters.length > 0 && !mayLetIn ? (
        <text fg={theme.dim} truncate wrapMode="none" flexShrink={0}>
          {"  "}your role here does not let people in
        </text>
      ) : null}
    </box>
  );
}

/** The most a name takes before the rest of its row. */
const NAME_MAX = 24;

const rowId = (key: string): string => `waiter-${key}`;
/** Pad to `width` terminal cells, wide characters counted as two. */
const padCells = (text: string, width: number): string => text + " ".repeat(Math.max(0, width - cells(text)));

/** One person who wants in: their name, then how they stand at the door. */
function WaiterRow({ waiter, selected, nameWidth }: { waiter: Waiter; selected: boolean; nameWidth: number }) {
  return (
    <box id={rowId(waiter.key)} flexDirection="row" flexShrink={0}>
      <text fg={selected ? theme.accent : theme.fg} wrapMode="none" flexShrink={0}>
        {selected ? "› " : "  "}
        <span fg={theme.warn}>● </span>
        {padCells(clip(waiter.name, nameWidth), nameWidth)}
      </text>
      <text fg={theme.dim} truncate wrapMode="none" flexShrink={1} minWidth={0} marginLeft={2}>
        {waiter.at === null ? "at the door, no invite" : `asked ${dateTimeOf(waiter.at)}`}
      </text>
    </box>
  );
}
