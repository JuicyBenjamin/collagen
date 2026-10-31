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
 *  a tool gives how many calls, where the middle half of them falls around
 *  that usual one, and the largest. */
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
  // the row shows the middle call; its hover says how far the calls around it spread
  const spread = (name: string) => {
    const sizes = byTool().get(name) ?? [];
    const at = (fraction: number) =>
      sizes[Math.min(sizes.length - 1, Math.floor(sizes.length * fraction))] ?? 0;
    return [
      `${sizes.length.toLocaleString()} calls`,
      `Half between ${compact(at(0.25))} and ${compact(at(0.75))}`,
      `Largest ${compact(sizes.at(-1) ?? 0)}`,
    ];
  };
  return (
    <section class="audit-panel">
      <h2>Tokens a call</h2>
      <p class="audit-sub">{SUB}</p>
      <Ranked
        rows={rows()}
        label={compact}
        details={spread}
        ariaLabel="Tokens in a usual call of each tool"
      />
    </section>
  );
}

Spread.Skeleton = () => <PanelSkeleton title="Tokens a call" sub={SUB} height={288} />;
