import { createEffect, onCleanup } from "solid-js";
import { mountChart, type ChartHost, type ChartHostOptions, type ChartValue } from "@tanstack/charts";

/** A TanStack chart on the page. Its own Solid adapter is written for Solid
 *  1 (solid-js/web), so the framework-free host is mounted here instead: the
 *  same definitions, sized to its container's width, updated when the
 *  definition moves, destroyed with the part. */
export function Chart<TDatum, TXValue extends ChartValue, TYValue extends ChartValue>(props: { definition: ChartHostOptions<TDatum, TXValue, TYValue>["definition"]; ariaLabel: string; height: number }) {
  let host: ChartHost<TDatum, TXValue, TYValue> | undefined;
  const options = (): ChartHostOptions<TDatum, TXValue, TYValue> => ({ definition: props.definition, ariaLabel: props.ariaLabel, height: props.height, initialWidth: 600 });
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
