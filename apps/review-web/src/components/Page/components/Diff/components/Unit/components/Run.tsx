import { For } from "solid-js";
import type { Hunk as HunkData } from "~/data";
import { Hunk, wholeRun } from "./Hunk";

/** One file's changes in a unit, in one card: its header stays at the top of
 *  the window through all of them. */
export function Run(props: { run: ReadonlyArray<HunkData>; hunks: ReadonlyMap<string, HunkData>; unexplained: ReadonlySet<string> }) {
  const whole = wholeRun(props.run);
  /** What the diff skips between one change of a file and the next in this
   *  unit: how many lines, and how many changes among them sit in another unit. */
  const skippedBefore = (above: HunkData, hunk: HunkData) => {
    const from = above.newStart + above.newLines;
    const elsewhere = [...props.hunks.values()].filter((other) => other.file === hunk.file && other.newStart >= from && other.newStart < hunk.newStart).length;
    return { lines: hunk.newStart - from, elsewhere };
  };
  return (
    <div class="hunk-group">
      <For each={props.run}>
        {(hunk, index) => <Hunk hunk={hunk} whole={whole} continued={index() > 0} skipped={index() > 0 ? skippedBefore(props.run[index() - 1]!, hunk) : undefined} unexplained={props.unexplained.has(hunk.id)} />}
      </For>
    </div>
  );
}
