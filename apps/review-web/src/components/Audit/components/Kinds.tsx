import { createMemo } from "solid-js";
import type { AuditPage } from "~/data";
import { KINDS, kindWord } from "../kinds";
import { PanelSkeleton } from "./PanelSkeleton";
import { Ranked } from "./Ranked";

const SUB = "What collagen was asked to do";
/** The tools a kind's hover names, the busiest first. */
const NAMED = 3;

/** What collagen's calls were for: the calls by kind of tool; hovering a
 *  kind names the tools that made it up. */
export function Kinds(props: { tools: AuditPage["tools"] }) {
  const rows = createMemo(() =>
    KINDS.map((kind) => ({
      name: kindWord(kind),
      value: props.tools
        .filter((tool) => tool.kind === kind)
        .reduce((sum, tool) => sum + tool.calls, 0),
    })).filter((row) => row.value > 0),
  );
  const toolsOf = (name: string) => {
    const these = props.tools
      .filter((tool) => kindWord(tool.kind) === name)
      .sort((a, b) => b.calls - a.calls);
    const rest = these.length - NAMED;
    return [
      ...these.slice(0, NAMED).map((tool) => `${tool.tool} ${tool.calls.toLocaleString()}`),
      ...(rest > 0 ? [`and ${rest} more ${rest === 1 ? "tool" : "tools"}`] : []),
    ];
  };
  return (
    <section class="audit-panel">
      <h2>Calls by kind</h2>
      <p class="audit-sub">{SUB}</p>
      <Ranked
        rows={rows()}
        label={(value) => value.toLocaleString()}
        details={toolsOf}
        ariaLabel="Collagen's calls by kind of tool"
      />
    </section>
  );
}

Kinds.Skeleton = () => <PanelSkeleton title="Calls by kind" sub={SUB} height={260} />;
