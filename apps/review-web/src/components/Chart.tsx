import { createEffect, createSignal, onCleanup } from "solid-js";
import { mountChart, type ChartHost, type ChartHostOptions, type ChartValue } from "@tanstack/charts";

/** A TanStack chart on the page. Its own Solid adapter is written for Solid
 *  1 (solid-js/web), so the framework-free host is mounted here instead: the
 *  same definitions, drawn at its container's own width (measured here, so a
 *  chart in a narrow column is laid out for it rather than shrunk), updated
 *  when the definition or the width moves, destroyed with the part. */
export function Chart<TDatum, TXValue extends ChartValue, TYValue extends ChartValue>(props: { definition: ChartHostOptions<TDatum, TXValue, TYValue>["definition"]; ariaLabel: string; height: number }) {
  let host: ChartHost<TDatum, TXValue, TYValue> | undefined;
  let element: HTMLDivElement | undefined;
  const [width, setWidth] = createSignal(0);
  const observer = new ResizeObserver((entries) => {
    const measured = Math.floor(entries[0]?.contentRect.width ?? 0);
    if (measured > 0) setWidth(measured);
  });
  const options = (): ChartHostOptions<TDatum, TXValue, TYValue> => ({ definition: props.definition, ariaLabel: props.ariaLabel, height: props.height, width: width() });
  createEffect(
    () => (width() > 0 ? options() : null),
    (next) => {
      if (!next || !element) return;
      if (host) host.update(next);
      else host = mountChart(element, next);
    },
  );
  onCleanup(() => {
    observer.disconnect();
    host?.destroy();
  });
  return (
    <div
      class="chart"
      style={{ height: `${props.height}px` }}
      ref={(placed) => {
        element = placed;
        observer.observe(placed);
      }}
    />
  );
}
