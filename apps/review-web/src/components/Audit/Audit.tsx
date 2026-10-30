import { createEffect, createMemo, createSignal, Errored, For } from "solid-js";
import { lasting } from "~/lasting";
import { overSocket } from "~/liveSocket";
import { Arrives } from "~/components/Arrives";
import { Calendar } from "./components/Calendar";
import { Compactions } from "./components/Compactions";
import { Definitions } from "./components/Definitions";
import { Growing } from "./components/Growing";
import { Harnesses } from "./components/Harnesses";
import { Runs } from "./components/Runs";
import { Kinds } from "./components/Kinds";
import { Models } from "./components/Models";
import { PerCall } from "./components/PerCall";
import { Sessions } from "./components/Sessions";
import { Share } from "./components/Share";
import { Spread } from "./components/Spread";
import { Stats } from "./components/Stats";
import { Steering } from "./components/Steering";
import { Tickets } from "./components/Tickets";
import { Tokens } from "./components/Tokens";

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
              <button
                type="button"
                class={["btn btn-sm join-item", { "btn-primary": days() === period }]}
                onClick={() => setDays(period)}
              >
                {period} days
              </button>
            )}
          </For>
        </div>
      </header>
      <Errored
        fallback={(error) => (
          <p class="failed">
            {error() instanceof Error ? (error() as Error).message : String(error())}
          </p>
        )}
      >
        <Arrives skeleton={() => <Audit.Skeleton />}>
          <div class="audit-body">
            <Stats totals={page().totals} />
            <div class="audit-pair audit-trio">
              <Share totals={page().totals} />
              <Calendar calls={page().calls} days={page().days} />
              <Growing growing={page().growing} />
            </div>
            <PerCall calls={page().calls} />
            <div class="audit-pair">
              <Tokens tools={page().tools} />
              <Spread calls={page().calls} />
            </div>
            <div class="audit-pair">
              <Kinds tools={page().tools} />
              <Definitions definitions={page().definitions} tools={page().tools} />
            </div>
            <div class="audit-pair">
              <Harnesses harnesses={page().harnesses} />
              <Models models={page().models} />
            </div>
            <div class="audit-pair">
              <Steering steering={page().steering} />
              <Tickets tickets={page().tickets} />
            </div>
            <Compactions compactions={page().compactions} />
            <div class="audit-pair">
              <Runs runs={page().runs} tokens={page().totals.runTokens} />
              <Sessions sessions={page().sessions} />
            </div>
          </div>
        </Arrives>
      </Errored>
    </main>
  );
}

/** The page before its first read: every panel's own skeleton, where and
 *  as tall as the panel will be — what is known already shown, the numbers masked. */
Audit.Skeleton = () => (
  <div class="audit-body" role="status" aria-busy="true" aria-label="Counting">
    <Stats.Skeleton />
    <div class="audit-pair audit-trio">
      <Share.Skeleton />
      <Calendar.Skeleton />
      <Growing.Skeleton />
    </div>
    <PerCall.Skeleton />
    <div class="audit-pair">
      <Tokens.Skeleton />
      <Spread.Skeleton />
    </div>
    <div class="audit-pair">
      <Kinds.Skeleton />
      <Definitions.Skeleton />
    </div>
    <div class="audit-pair">
      <Harnesses.Skeleton />
      <Models.Skeleton />
    </div>
    <div class="audit-pair">
      <Steering.Skeleton />
      <Tickets.Skeleton />
    </div>
    <Compactions.Skeleton />
    <div class="audit-pair">
      <Runs.Skeleton />
      <Sessions.Skeleton />
    </div>
  </div>
);
