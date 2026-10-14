import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { Portal } from "@solidjs/web";
import { Appear } from "~/components/Appear";
import { Arrives } from "~/components/Arrives";
import { Masked } from "~/components/Masked";
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
 *  has it: a count and a bar. Scrolled out of sight, it floats in the
 *  corner instead, so it stays in view as they read. Waits on the diff. */
export function Progress() {
  const [away, setAway] = createSignal(false);
  let seen: IntersectionObserver | undefined;
  const watch = (element: HTMLElement) => {
    seen?.disconnect();
    seen = new IntersectionObserver(([entry]) => setAway(!entry!.isIntersecting));
    seen.observe(element);
  };
  onCleanup(() => seen?.disconnect());
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
    <>
      <Arrives inline skeleton={Progress.Skeleton} ready={viewed.read()}>
        <Show when={viewed.count().files > 0}>
          <span ref={watch}>
            <Count />
          </span>
        </Show>
      </Arrives>
      <Portal>
        <Appear when={away() && viewed.count().files > 0}>
          {() => (
            <div class="progress-float" role="status">
              <Count />
            </div>
          )}
        </Appear>
      </Portal>
    </>
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
