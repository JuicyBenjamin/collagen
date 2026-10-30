import { createEffect, createMemo, Errored, For, Show } from "solid-js";
import { lasting } from "~/lasting";
import { overSocket } from "~/liveSocket";
import { Arrives } from "~/components/Arrives";
import { Masked } from "~/components/Masked";
import { Goal } from "./components/Goal";
import { Header } from "./components/Header";
import { Outline } from "./components/Outline";
import { Questions } from "./components/Questions";

// An investigation's page: what was found, goal by goal, read at a glance —
// each answer as the blocks its run chose, the full findings one click
// away — with who answered and with what, and the questions only the
// reader can decide. Live over the page's socket: the instance sends the
// page whenever the investigation moves (a run posts, a goal is added), so
// no read holds one of the browser's few connections.

/** /investigation/<ticketId> — the page's one argument; null on any other page. */
export const investigationPlace: string | null = (() => {
  const [first, id] = location.pathname.split("/").filter(Boolean);
  if (first !== "investigation") return null;
  try {
    return decodeURIComponent(id ?? "");
  } catch {
    return "";
  }
})();

export function Investigation(props: { ticketId: string }) {
  // the page itself, held open over the socket while the page is: drawn
  // again from each value as the investigation moves
  const read = createMemo(() => lasting(() => overSocket("investigation", props.ticketId)));
  const page = createMemo(() => {
    const now = read();
    if (now === null) throw new Error("No investigation with this id in your rooms.");
    return now;
  });
  createEffect(
    () => page(),
    (read) => {
      document.title = read.title;
    },
  );
  return (
    <Errored fallback={(error) => <p class="failed">{error() instanceof Error ? (error() as Error).message : String(error())}</p>}>
      <Arrives skeleton={() => <Investigation.Skeleton />}>
        <div class="wrap">
          <Outline groups={page().groups} questions={page().questions.length} />
          <main class="inv-main">
            <Header page={page()} />
            <For each={page().groups}>
              {(group) => (
                <section class="inv-group">
                  <Show when={group.name}>{(name) => <h2 class="inv-group-name">{name()}</h2>}</Show>
                  <For each={group.goals}>{(goal) => <Goal goal={goal} />}</For>
                </section>
              )}
            </For>
            <Questions ticketId={props.ticketId} questions={page().questions} />
          </main>
        </div>
      </Arrives>
    </Errored>
  );
}

/** The page before its read is in: its header and two goals, words masked. */
Investigation.Skeleton = () => (
  <div class="wrap">
    <nav />
    <main class="inv-main">
      <header class="inv-header">
        <h1>
          <Masked>Delta DB in collagen</Masked>
        </h1>
        <p class="inv-question">
          <Masked>Could we implement it, or take what makes it work?</Masked>
        </p>
      </header>
      <For each={[0, 1]}>
        {() => (
          <article class="card card-border inv-goal">
            <div class="card-body">
              <h3 class="card-title">
                <Masked>A goal of the investigation</Masked>
              </h3>
              <p>
                <Masked>What was found, in a line or two of points</Masked>
              </p>
            </div>
          </article>
        )}
      </For>
    </main>
  </div>
);
