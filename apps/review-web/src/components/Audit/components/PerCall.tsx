import { createMemo, createSignal, For } from "solid-js";
import { defineChart, dot, lineY } from "@tanstack/charts";
import { decorative } from "@tanstack/charts/mark/decorative";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import { Chart } from "~/components/Chart";
import type { AuditPage } from "~/data";
import { compact, day } from "../numbers";

const WEEK = 7 * 24 * 60 * 60 * 1000;

/** Every call of one tool as a dot, its weekly average as a line: a tool
 *  that starts putting more into the window shows as the line climbing. */
export function PerCall(props: { perCall: AuditPage["perCall"] }) {
  const [picked, setPicked] = createSignal<string | null>(null);
  const shown = createMemo(() => props.perCall.find((tool) => tool.tool === picked()) ?? props.perCall.find((tool) => tool.tool === "get-tickets") ?? props.perCall[0]);
  const calls = createMemo(() => (shown()?.calls ?? []).map((call, index) => ({ id: `${index}`, time: Date.parse(call.at), tokens: call.tokens })));
  const weeks = createMemo(() => {
    const all = calls();
    if (all.length === 0) return [];
    const start = Math.min(...all.map((call) => call.time));
    const buckets = new Map<number, Array<number>>();
    for (const call of all) {
      const week = Math.floor((call.time - start) / WEEK);
      buckets.set(week, [...(buckets.get(week) ?? []), call.tokens]);
    }
    return [...buckets].sort(([a], [b]) => a - b).map(([week, tokens]) => ({ id: `w${week}`, time: start + week * WEEK + WEEK / 2, tokens: Math.round(tokens.reduce((sum, value) => sum + value, 0) / tokens.length) }));
  });
  const average = (from: number, to: number) => {
    const these = calls().filter((call) => call.time >= from && call.time < to);
    return these.length === 0 ? null : Math.round(these.reduce((sum, call) => sum + call.tokens, 0) / these.length);
  };
  const lastWeek = () => average(Date.now() - WEEK, Infinity);
  const before = () => average(0, Date.now() - WEEK);
  const definition = createMemo(() =>
    defineChart({
      marks: [
        dot(calls(), { x: "time", y: "tokens", r: 3.5, fill: "var(--color-primary)", fillOpacity: 0.4 }),
        decorative(lineY(weeks(), { x: "time", y: "tokens", stroke: "var(--color-primary)", strokeWidth: 2.5 })),
      ],
      scales: {
        x: { scale: scaleLinear, axis: { ticks: { format: (value: number) => day(value) } } },
        y: { scale: scaleLinear, nice: true, grid: true, axis: { ticks: { format: (value: number) => compact(value) } } },
      },
      tooltip,
    }),
  );
  return (
    <section class="audit-panel">
      <div class="audit-panel-head">
        <h2>Tokens per call</h2>
        <div class="join">
          <For each={props.perCall}>
            {(tool) => (
              <button type="button" class={["btn btn-xs join-item", { "btn-primary": tool.tool === shown()?.tool }]} onClick={() => setPicked(tool.tool)}>
                {tool.tool}
              </button>
            )}
          </For>
        </div>
      </div>
      <dl class="audit-facts">
        <div>
          <dt>Before the last week</dt>
          <dd>{before() === null ? "none" : `${compact(before()!)} tokens a call`}</dd>
        </div>
        <div>
          <dt>Last week</dt>
          <dd>{lastWeek() === null ? "none" : `${compact(lastWeek()!)} tokens a call`}</dd>
        </div>
      </dl>
      <Chart definition={definition()} ariaLabel={`${shown()?.tool ?? ""} tokens per call over time`} height={280} />
    </section>
  );
}
