import { createEffect, onCleanup, Show } from "solid-js";
import { Arrives } from "~/components/Arrives";
import { Masked } from "~/components/Masked";
import { followPill, setFloating } from "~/floating";
import { kept } from "~/kept";
import { ticketId } from "~/ticket";
import { viewed } from "~/viewedNow";
import { Count } from "./components/Count";

/** The count as it read last time, for its placeholder's width. */
const lastCount = kept(
  `collagen.progress.v1.${ticketId}`,
  (value): value is string => typeof value === "string",
);

/** How far through the review's files the reader is, as GitHub's toolbar
 *  has it: a count and a bar. Scrolled well out of sight, it floats in the
 *  corner instead (the review's Corner, floating.ts), so it stays in view as
 *  they read.
 *  Waits on the diff. */
export function Progress() {
  let stop: (() => void) | undefined;
  const watch = (element: HTMLElement) => {
    stop?.();
    stop = followPill(element);
  };
  onCleanup(() => {
    stop?.();
    setFloating(false);
  });
  createEffect(
    () =>
      viewed.read() && viewed.count().files > 0
        ? `${viewed.count().viewed} / ${viewed.count().files} files viewed`
        : null,
    (said) => {
      if (said) lastCount.keep(said);
    },
  );
  return (
    <Arrives inline skeleton={Progress.Skeleton} ready={viewed.read()}>
      <Show when={viewed.count().files > 0}>
        <span ref={watch}>
          <Count />
        </span>
      </Show>
    </Arrives>
  );
}

Progress.Skeleton = function Skeleton() {
  return (
    <span class="sk" aria-hidden="true">
      <span class="viewed-progress">
        <span class="bar" />
        <Masked>{lastCount.last ?? "0 / 10 files viewed"}</Masked>
      </span>
    </span>
  );
};
