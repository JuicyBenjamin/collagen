import { createMemo } from "solid-js";
import type { AuditPage } from "~/data";
import { KINDS, kindWord } from "../kinds";
import { PanelSkeleton } from "./PanelSkeleton";
import { Ranked } from "./Ranked";

/** What collagen's calls were for: the calls by kind of tool. */
export function Kinds(props: { tools: AuditPage["tools"] }) {
  const rows = createMemo(() =>
    KINDS.map((kind) => ({
      name: kindWord(kind),
      value: props.tools
        .filter((tool) => tool.kind === kind)
        .reduce((sum, tool) => sum + tool.calls, 0),
    })).filter((row) => row.value > 0),
  );
  return (
    <section class="audit-panel">
      <h2>Calls by kind</h2>
      <p class="audit-sub">What collagen was asked to do</p>
      <Ranked
        rows={rows()}
        label={(value) => value.toLocaleString()}
        says={(value) => `${value.toLocaleString()} calls`}
        ariaLabel="Collagen's calls by kind of tool"
      />
    </section>
  );
}

Kinds.Skeleton = () => (
  <PanelSkeleton title="Calls by kind" sub="What collagen was asked to do" height={260} />
);
