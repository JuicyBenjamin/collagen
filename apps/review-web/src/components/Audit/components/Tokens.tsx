import { createMemo } from "solid-js";
import { defineChart } from "@tanstack/charts";
import { treemap } from "@tanstack/charts/hierarchy/treemap";
import { tooltip } from "@tanstack/charts/tooltip";
import { Chart } from "~/components/Chart";
import type { AuditPage } from "~/data";
import { compact } from "../numbers";
import { PanelSkeleton } from "./PanelSkeleton";

/** A tool smaller than this share of all the tokens joins "Other", so every
 *  tile shown is big enough to name. */
const SMALLEST = 0.02;

/** Where collagen's tokens go: every tool a tile the size of its tokens in and out. */
export function Tokens(props: { tools: AuditPage["tools"] }) {
  const total = () => props.tools.reduce((sum, tool) => sum + tool.tokensIn + tool.tokensOut, 0);
  const rows = createMemo(() => {
    const all = props.tools
      .map((tool) => ({ name: tool.tool, tokens: tool.tokensIn + tool.tokensOut }))
      .filter((row) => row.tokens > 0);
    const big = all.filter((row) => row.tokens >= total() * SMALLEST);
    const rest = all
      .filter((row) => row.tokens < total() * SMALLEST)
      .reduce((sum, row) => sum + row.tokens, 0);
    return [...big, ...(rest > 0 ? [{ name: "Other", tokens: rest }] : [])];
  });
  const definition = createMemo(() =>
    defineChart({
      marks: [
        treemap(rows(), {
          path: "name",
          value: "tokens",
          fill: (node) => (node.name === "Other" ? "var(--viz-context)" : "var(--viz-1)"),
          label: (node) => `${node.name} ${compact(node.value)}`,
          labelFill: "#ffffff",
          labelFontWeight: 600,
          inset: 1,
          stroke: "var(--panel)",
          strokeWidth: 2,
        }),
      ],
      scales: { x: null, y: null },
      tooltip: {
        use: tooltip,
        content: ([point]) => {
          const node = point?.datum as { name?: string; value?: number } | undefined;
          return node?.name
            ? {
                title: node.name,
                rows: [{ label: "", value: `${node.value!.toLocaleString()} tokens` }],
              }
            : { rows: [] };
        },
      },
    }),
  );
  return (
    <section class="audit-panel">
      <h2>Where the tokens go</h2>
      <p class="audit-sub">{compact(total())} tokens in and out, by tool</p>
      <Chart definition={definition()} ariaLabel="Tokens in and out by tool" height={320} />
    </section>
  );
}

Tokens.Skeleton = () => (
  <PanelSkeleton
    title="Where the tokens go"
    pending="1.0M tokens in and out, by tool"
    height={320}
  />
);
