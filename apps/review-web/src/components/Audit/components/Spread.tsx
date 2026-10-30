import { createMemo } from "solid-js";
import type { AuditPage } from "~/data";
import { compact } from "../numbers";
import { PanelSkeleton } from "./PanelSkeleton";
import { Ranked } from "./Ranked";

/** Tools called often enough to have a usual size, and how many to show. */
const ENOUGH = 5;
const SHOWN = 10;

/** How much one call of each tool usually puts in the window: the middle
 *  call of each, so one huge call does not make a tool look heavy. */
export function Spread(props: { calls: AuditPage["calls"] }) {
  const rows = createMemo(() => {
    const byTool = new Map<string, Array<number>>();
    for (const call of props.calls)
      byTool.set(call.tool, [...(byTool.get(call.tool) ?? []), call.tokens]);
    return [...byTool]
      .filter(([, tokens]) => tokens.length >= ENOUGH)
      .map(([name, tokens]) => {
        const sorted = [...tokens].sort((a, b) => a - b);
        return { name, value: sorted[Math.floor(sorted.length / 2)]! };
      })
      .sort((a, b) => b.value - a.value)
      .slice(0, SHOWN);
  });
  return (
    <section class="audit-panel">
      <h2>Tokens a call</h2>
      <p class="audit-sub">A usual call of each tool</p>
      <Ranked
        rows={rows()}
        label={compact}
        says={(value) => `${value.toLocaleString()} tokens`}
        ariaLabel="Tokens in a usual call of each tool"
      />
    </section>
  );
}

Spread.Skeleton = () => (
  <PanelSkeleton title="Tokens a call" sub="A usual call of each tool" height={288} />
);
