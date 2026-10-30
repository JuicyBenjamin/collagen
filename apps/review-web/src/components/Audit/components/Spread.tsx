import { createMemo } from "solid-js";
import type { AuditPage } from "~/data";
import { compact } from "../numbers";
import { PanelSkeleton } from "./PanelSkeleton";
import { Ranked } from "./Ranked";

/** Tools called often enough to have a usual size, and how many to show. */
const ENOUGH = 5;
const SHOWN = 10;
const SUB = "A usual call of each tool";

/** How much one call of each tool usually puts in the window: the middle
 *  call of each, so one huge call does not make a tool look heavy. Hovering
 *  a tool gives how many calls and the smallest and largest of them. */
export function Spread(props: { calls: AuditPage["calls"] }) {
  const byTool = createMemo(() => {
    const tokens = new Map<string, Array<number>>();
    for (const call of props.calls)
      tokens.set(call.tool, [...(tokens.get(call.tool) ?? []), call.tokens]);
    return new Map([...tokens].map(([tool, sizes]) => [tool, [...sizes].sort((a, b) => a - b)]));
  });
  const rows = createMemo(() =>
    [...byTool()]
      .filter(([, sizes]) => sizes.length >= ENOUGH)
      .map(([name, sizes]) => ({ name, value: sizes[Math.floor(sizes.length / 2)]! }))
      .sort((a, b) => b.value - a.value)
      .slice(0, SHOWN),
  );
  const range = (name: string) => {
    const sizes = byTool().get(name) ?? [];
    return [
      `${sizes.length.toLocaleString()} calls`,
      `${compact(sizes[0] ?? 0)} to ${compact(sizes.at(-1) ?? 0)} tokens`,
    ];
  };
  return (
    <section class="audit-panel">
      <h2>Tokens a call</h2>
      <p class="audit-sub">{SUB}</p>
      <Ranked
        rows={rows()}
        label={compact}
        details={range}
        ariaLabel="Tokens in a usual call of each tool"
      />
    </section>
  );
}

Spread.Skeleton = () => <PanelSkeleton title="Tokens a call" sub={SUB} height={288} />;
