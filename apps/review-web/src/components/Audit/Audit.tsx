import { createEffect, createMemo, createSignal, Errored, For } from "solid-js";
import { lasting } from "~/lasting";
import { overSocket } from "~/liveSocket";
import { Arrives } from "~/components/Arrives";
import { Compactions } from "./components/Compactions";
import { Definitions } from "./components/Definitions";
import { Growing } from "./components/Growing";
import { Harnesses } from "./components/Harnesses";
import { InOut } from "./components/InOut";
import { Jobs } from "./components/Jobs";
import { PerCall } from "./components/PerCall";
import { Sessions } from "./components/Sessions";
import { Stats } from "./components/Stats";
import { Steering } from "./components/Steering";
import { Tickets } from "./components/Tickets";
import { ToolCalls } from "./components/ToolCalls";

// A room's audit page: what collagen did and what it cost, drawn with
// TanStack Charts. Live over the page's socket: the instance sends the page
// again as the logs, the room's tickets or the person's steering move.

/** /audit/<roomId> — the page's one argument; null on any other page. */
export const auditPlace: string | null = (() => {
  const [first, id] = location.pathname.split("/").filter(Boolean);
  if (first !== "audit") return null;
  try {
    return decodeURIComponent(id ?? "");
  } catch {
    return "";
  }
})();

const PERIODS = [7, 30, 90] as const;

export function Audit(props: { roomId: string }) {
  const [days, setDays] = createSignal<number>(30);
  const read = createMemo(() => lasting(() => overSocket("audit", `${props.roomId}:${days()}`)));
  const page = createMemo(() => {
    const now = read();
    if (now === null) throw new Error("This room is not open here.");
    return now;
  });
  createEffect(
    () => page(),
    (shown) => {
      document.title = `Audit · ${shown.room}`;
    },
  );
  return (
    <main class="audit">
      <header class="audit-head">
        <h1>Audit</h1>
        <div class="join">
          <For each={PERIODS}>
            {(period) => (
              <button type="button" class={["btn btn-sm join-item", { "btn-primary": days() === period }]} onClick={() => setDays(period)}>
                {period} days
              </button>
            )}
          </For>
        </div>
      </header>
      <Errored fallback={(error) => <p class="failed">{error() instanceof Error ? (error() as Error).message : String(error())}</p>}>
        <Arrives skeleton={() => <Audit.Skeleton />}>
          <div class="audit-body">
          <Stats totals={page().totals} />
          <div class="audit-pair audit-pair-wide">
            <PerCall perCall={page().perCall} />
            <Growing growing={page().growing} />
          </div>
          <div class="audit-pair">
            <ToolCalls tools={page().tools} />
            <InOut tools={page().tools} />
          </div>
          <div class="audit-pair">
            <Harnesses harnesses={page().harnesses} models={page().models} />
            <Jobs jobs={page().jobs} cost={page().totals.jobCost} />
          </div>
          <Compactions compactions={page().compactions} />
          <div class="audit-pair">
            <Tickets tickets={page().tickets} />
            <Steering steering={page().steering} />
          </div>
          <div class="audit-pair">
            <Sessions sessions={page().sessions} />
            <Definitions definitions={page().definitions} />
          </div>
          </div>
        </Arrives>
      </Errored>
    </main>
  );
}

/** The page before its first read: every panel's own skeleton, where and
 *  as tall as the panel will be. */
Audit.Skeleton = () => (
  <div class="audit-body sk" role="status" aria-busy="true" aria-label="Counting">
    <Stats.Skeleton />
    <div class="audit-pair audit-pair-wide">
      <PerCall.Skeleton />
      <Growing.Skeleton />
    </div>
    <div class="audit-pair">
      <ToolCalls.Skeleton />
      <InOut.Skeleton />
    </div>
    <div class="audit-pair">
      <Harnesses.Skeleton />
      <Jobs.Skeleton />
    </div>
    <Compactions.Skeleton />
    <div class="audit-pair">
      <Tickets.Skeleton />
      <Steering.Skeleton />
    </div>
    <div class="audit-pair">
      <Sessions.Skeleton />
      <Definitions.Skeleton />
    </div>
  </div>
);
