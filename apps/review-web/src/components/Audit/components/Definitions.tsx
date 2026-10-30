import { createMemo } from "solid-js";
import type { AuditPage } from "~/data";
import { compact } from "../numbers";
import { PanelSkeleton } from "./PanelSkeleton";
import { Ranked } from "./Ranked";

const SHOWN = 10;

/** What collagen's tool definitions put into every session's window, loaded
 *  when it starts and read again with each reply, used or not: the largest.
 *  Hovering one says how often it was called, so a large one seldom used stands out. */
export function Definitions(props: {
  definitions: AuditPage["definitions"];
  tools: AuditPage["tools"];
}) {
  const rows = createMemo(() =>
    props.definitions
      .slice(0, SHOWN)
      .map((definition) => ({ name: definition.tool, value: definition.tokens })),
  );
  const total = () => props.definitions.reduce((sum, definition) => sum + definition.tokens, 0);
  const called = (name: string) => {
    const calls = props.tools.find((tool) => tool.tool === name)?.calls ?? 0;
    return [
      calls === 0
        ? "Not called in this period"
        : `Called ${calls.toLocaleString()} ${calls === 1 ? "time" : "times"}`,
    ];
  };
  return (
    <section class="audit-panel">
      <h2>Tool definitions</h2>
      <p class="audit-sub">
        {props.definitions.length} tools, {compact(total())} tokens in every session. The largest:
      </p>
      <Ranked
        rows={rows()}
        label={compact}
        details={called}
        ariaLabel="The largest tool definitions, in tokens"
      />
    </section>
  );
}

Definitions.Skeleton = () => (
  <PanelSkeleton
    title="Tool definitions"
    pending="64 tools, 25k tokens in every session. The largest:"
    height={288}
  />
);
