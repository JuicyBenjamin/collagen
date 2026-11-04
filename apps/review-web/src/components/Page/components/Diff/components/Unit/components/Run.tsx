import { createSignal, For, onCleanup, Show } from "solid-js";
import type { Hunk as HunkData } from "~/data";
import { nearNow } from "~/nearNow";
import { Hunk, wholeRun } from "../../Hunk";

/** A line of code drawn, and a change's header: what a card not drawn stands in for. */
const ROW = 20;
const HEADER = 55;

/** One file's changes in a unit, in one card: its header stays at the top of
 *  the window through all of them. Its code is drawn only while the card is
 *  near the window (nearNow) — a big review drawn whole stalls the page on
 *  every change — and stands as a block of its height the rest of the time:
 *  what it last measured, or, never drawn, what its lines would take. */
export function Run(props: { run: ReadonlyArray<HunkData>; hunks: ReadonlyMap<string, HunkData>; unexplained: ReadonlySet<string> }) {
  const whole = wholeRun(props.run);
  const file = () => props.run[0]!.file;
  const [near, setNear] = createSignal(false);
  // what the card stood at when its code was last drawn
  let height: number | null = null;
  const estimate = () => props.run.reduce((sum, hunk) => sum + hunk.lines.length * ROW + HEADER, 0);
  const drawn = () => near() || nearNow.kept(file());
  /** What the diff skips between one change of a file and the next in this
   *  unit: how many lines, and how many changes among them sit in another unit. */
  const skippedBefore = (above: HunkData, hunk: HunkData) => {
    const from = above.newStart + above.newLines;
    const elsewhere = [...props.hunks.values()].filter((other) => other.file === hunk.file && other.newStart >= from && other.newStart < hunk.newStart).length;
    return { lines: hunk.newStart - from, elsewhere };
  };
  const watch = (card: HTMLDivElement) => {
    const stop = nearNow.watch(card, (isNear, stood) => {
      // leaving: its drawn height is what it stands at while away
      if (!isNear && drawn()) height = stood;
      setNear(isNear);
    });
    onCleanup(stop);
  };
  return (
    <div class="hunk-group" ref={watch} style={drawn() ? undefined : { height: `${height ?? estimate()}px` }}>
      <Show when={drawn()}>
        <For each={props.run}>
          {(hunk, index) => <Hunk hunk={hunk} whole={whole} continued={index() > 0} skipped={index() > 0 ? skippedBefore(props.run[index() - 1]!, hunk) : undefined} unexplained={props.unexplained.has(hunk.id)} />}
        </For>
      </Show>
    </div>
  );
}
