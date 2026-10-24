import { For } from "solid-js";
import type { MergeFor as Level } from "~/data";
import { Appear } from "~/components/Appear";
import { mergeNow } from "~/mergeNow";

export const LEVELS: ReadonlyArray<{ readonly value: Level; readonly label: string }> = [
  { value: "off", label: "never" },
  { value: "theirs", label: "when someone else approves" },
  { value: "mine", label: "when I accept" },
  { value: "both", label: "when they approve and I accept" },
];
export const labelOf = (level: Level) => LEVELS.find((option) => option.value === level)!.label;

/** Whether collagen merges the reader's own review for them, set ahead and
 *  quietly beside its pull request: its own level, or its room's. Accept
 *  only tells what it will do. */
export function MergeFor() {
  return (
    <Appear when={mergeNow.view()}>
      {(view) => (
        <label class="merge-for">
          Merge
          <select class="select select-ghost select-xs" value={view().own ?? "room"} onChange={(event) => void mergeNow.set(event.currentTarget.value === "room" ? null : (event.currentTarget.value as Level))}>
            <option value="room">as the room: {labelOf(view().room)}</option>
            <For each={LEVELS}>{(option) => <option value={option.value}>{option.label}</option>}</For>
          </select>
        </label>
      )}
    </Appear>
  );
}
