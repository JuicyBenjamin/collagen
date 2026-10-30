import { createMemo } from "solid-js";
import { defineChart } from "@tanstack/charts";
import { treemap } from "@tanstack/charts/hierarchy/treemap";
import { tooltip } from "@tanstack/charts/tooltip";
import { Chart } from "~/components/Chart";
import type { AuditPage } from "~/data";
import { compact } from "../numbers";
import { KIND_COLOUR, kindWord } from "../kinds";
import { PanelSkeleton } from "./PanelSkeleton";

/** Where collagen's tokens go: every tool a tile the size of its tokens in
 *  and out, grouped and coloured by what kind of tool it is. */
export function Tokens(props: { tools: AuditPage["tools"] }) {
  const rows = createMemo(() =>
    props.tools
      .filter((tool) => tool.tokensIn + tool.tokensOut > 0)
      .map((tool) => ({
        name: `${kindWord(tool.kind)}/${tool.tool}`,
        tool: tool.tool,
        kind: tool.kind,
        tokens: tool.tokensIn + tool.tokensOut,
      })),
  );
  const kindOf = createMemo(
    () =>
      new Map(
        props.tools.flatMap((tool) => [
          [tool.tool, tool.kind] as const,
          [kindWord(tool.kind), tool.kind] as const,
        ]),
      ),
  );
  const kinds = createMemo(() => [...new Set(rows().map((row) => row.kind))]);
  const definition = createMemo(() =>
    defineChart({
      marks: [
        treemap(rows(), {
          path: "name",
          delimiter: "/",
          value: "tokens",
          color: (node) => kindOf().get(node.name) ?? "other",
          label: (node) => node.id.split("/").at(-1) ?? "",
          inset: 1,
          labelFill: "var(--panel)",
          labelFontWeight: 600,
          stroke: "var(--panel)",
        }),
      ],
      scales: { x: null, y: null },
      color: { domain: kinds(), range: kinds().map((kind) => KIND_COLOUR[kind] ?? "var(--dim)") },
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
      <p class="audit-sub">
        {compact(props.tools.reduce((sum, tool) => sum + tool.tokensIn + tool.tokensOut, 0))} tokens
        in and out, by tool
      </p>
      <Chart
        definition={definition()}
        ariaLabel="Tokens in and out by tool, grouped by kind"
        height={360}
      />
    </section>
  );
}

Tokens.Skeleton = () => (
  <PanelSkeleton
    title="Where the tokens go"
    pending="1.2M tokens in and out, by tool"
    height={360}
  />
);
