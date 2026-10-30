import { createEffect, onCleanup } from "solid-js";
import { mountChart, type ChartHost, type ChartHostOptions } from "@tanstack/charts";

/** A TanStack chart on the page. Its own Solid adapter is written for Solid
 *  1 (solid-js/web), so the framework-free host is mounted here instead: the
 *  same definitions, sized to its container's width, updated when the
 *  definition moves, destroyed with the part. */
export function Chart(props: { definition: ChartHostOptions["definition"]; ariaLabel: string; height: number }) {
  let host: ChartHost | undefined;
  const options = (): ChartHostOptions => ({ definition: props.definition, ariaLabel: props.ariaLabel, height: props.height, initialWidth: 600 });
  createEffect(
    () => options(),
    (next) => host?.update(next),
  );
  onCleanup(() => host?.destroy());
  return (
    <div
      class="chart"
      ref={(element) => {
        host = mountChart(element, options());
      }}
    />
  );
}
