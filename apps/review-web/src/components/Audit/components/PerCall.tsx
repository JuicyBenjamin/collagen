import { createMemo, createSignal, For } from "solid-js";
import { defineChart, dot, lineY } from "@tanstack/charts";
import { decorative } from "@tanstack/charts/mark/decorative";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import { Chart } from "~/components/Chart";
import type { AuditPage } from "~/data";
import { dateOf, dateTimeOf } from "~/when";
import { compact } from "../numbers";
import { PanelSkeleton } from "./PanelSkeleton";
import { Pending } from "./Pending";

const WEEK = 7 * 24 * 60 * 60 * 1000;
/** The tools worth a pick: the ones with the most tokens, called often enough to have a trend. */
const PICKS = 5;
const ENOUGH = 5;

/** Every call of one tool as a dot, its weekly average as a line: a tool
 *  that starts putting more into the window shows as the line climbing. */
export function PerCall(props: { calls: AuditPage["calls"] }) {
  const tools = createMemo(() => {
    const totals = new Map<string, { calls: number; tokens: number }>();
    for (const call of props.calls) {
      const total = totals.get(call.tool) ?? { calls: 0, tokens: 0 };
      totals.set(call.tool, { calls: total.calls + 1, tokens: total.tokens + call.tokens });
    }
    return [...totals]
      .filter(([, total]) => total.calls >= ENOUGH)
      .sort((a, b) => b[1].tokens - a[1].tokens)
      .slice(0, PICKS)
      .map(([tool]) => tool);
  });
  const [picked, setPicked] = createSignal<string | null>(null);
  const shown = createMemo(
    () =>
      tools().find((tool) => tool === picked()) ??
      tools().find((tool) => tool === "get-tickets") ??
      tools()[0],
  );
  const calls = createMemo(() =>
    props.calls
      .filter((call) => call.tool === shown())
      .map((call, index) => ({ id: `${index}`, time: Date.parse(call.at), tokens: call.tokens })),
  );
  const weeks = createMemo(() => {
    const all = calls();
    if (all.length === 0) return [];
    const start = Math.min(...all.map((call) => call.time));
    const buckets = new Map<number, Array<number>>();
    for (const call of all) {
      const week = Math.floor((call.time - start) / WEEK);
      buckets.set(week, [...(buckets.get(week) ?? []), call.tokens]);
    }
    return [...buckets]
      .sort(([a], [b]) => a - b)
      .map(([week, tokens]) => ({
        id: `w${week}`,
        time: start + week * WEEK + WEEK / 2,
        tokens: Math.round(tokens.reduce((sum, value) => sum + value, 0) / tokens.length),
      }));
  });
  const average = (from: number, to: number) => {
    const these = calls().filter((call) => call.time >= from && call.time < to);
    return these.length === 0
      ? null
      : Math.round(these.reduce((sum, call) => sum + call.tokens, 0) / these.length);
  };
  const lastWeek = () => average(Date.now() - WEEK, Infinity);
  const before = () => average(0, Date.now() - WEEK);
  const definition = createMemo(() =>
    defineChart({
      focusRing: { fill: "var(--panel)", strokeWidth: 2 },
      marks: [
        dot(calls(), {
          x: "time",
          y: "tokens",
          r: 3.5,
          fill: "var(--viz-1)",
          fillOpacity: 0.4,
        }),
        decorative(
          lineY(weeks(), {
            x: "time",
            y: "tokens",
            stroke: "var(--viz-1)",
            strokeWidth: 2.5,
          }),
        ),
      ],
      scales: {
        x: { scale: scaleLinear, axis: { ticks: { format: (value: number) => dateOf(value) } } },
        y: {
          scale: scaleLinear,
          nice: true,
          grid: true,
          axis: { ticks: { format: (value: number) => compact(value) } },
        },
      },
      tooltip: {
        use: tooltip,
        content: ([point]) =>
          point
            ? {
                title: dateTimeOf(point.datum.time),
                rows: [{ label: "", value: `${point.datum.tokens.toLocaleString()} tokens` }],
              }
            : { rows: [] },
      },
    }),
  );
  return (
    <section class="audit-panel">
      <div class="audit-panel-head">
        <h2>Tokens per call</h2>
        <div class="join">
          <For each={tools()}>
            {(tool) => (
              <button
                type="button"
                class={["btn btn-xs join-item", { "btn-primary": tool === shown() }]}
                onClick={() => setPicked(tool)}
              >
                {tool}
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
      <Chart
        definition={definition()}
        ariaLabel={`${shown() ?? ""} tokens per call over time`}
        height={280}
      />
    </section>
  );
}

PerCall.Skeleton = () => (
  <PanelSkeleton title="Tokens per call">
    <p>
      <Pending>ask-review close-ticket propose review-context get-tickets</Pending>
    </p>
    <dl class="audit-facts">
      <div>
        <dt>Before the last week</dt>
        <dd>
          <Pending>2.6k tokens a call</Pending>
        </dd>
      </div>
      <div>
        <dt>Last week</dt>
        <dd>
          <Pending>1.4k tokens a call</Pending>
        </dd>
      </div>
    </dl>
    <div class="audit-sk-body" style={{ height: "278px" }} />
  </PanelSkeleton>
);
