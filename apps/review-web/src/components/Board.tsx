import { createEffect, createMemo, createSignal, Errored, For, Loading, Show } from "solid-js";
import type { BoardCard, BoardData } from "~/data";
import { boardData } from "~/api";
import { Corner } from "~/components/Corner";
import { lasting } from "~/lasting";
import { overSocket } from "~/liveSocket";
import { place, ticketHref } from "~/place";

// The board: a room's tickets in to do, in progress and done — the
// terminal's board, columns decided by the same rule (p2p boardColumn) on
// the instance. /room/<room>/board. Read through everything or one epic
// (#epic=<id>): epics are the views, not cards. What grew from what is one
// stack, each title showing; a stack fans out as the pointer comes over it.
// Done is what finished lately, the rest counted. Read-only: a review's or
// an investigation's card opens its page; everything else is acted on
// through the person's agent.

/** The room whose board this is, by its short id; null on any other page. */
export const boardPlace: string | null = place?.page === "board" ? place.roomShort : null;

/** The epic the address names: #epic=<id>. */
const epicInHash = (): string | null => /^#epic=([0-9a-f-]{8,64})$/.exec(location.hash)?.[1] ?? null;

async function load(roomShort: string, epic: string | null, allDone: boolean): Promise<BoardData> {
  const data = await boardData(roomShort, epic, allDone);
  if (!data) throw new Error(`no room ${roomShort} in your rooms`);
  return data;
}

export function BoardApp(props: { roomShort: string }) {
  const [epic, setEpic] = createSignal<string | null>(epicInHash());
  const [allDone, setAllDone] = createSignal(false);
  // the board's state, live over the page's socket while it is open: read again whenever it moves
  const state = createMemo(() => lasting(() => overSocket("board", props.roomShort)));
  const data = createMemo(() => {
    state();
    return load(props.roomShort, epic(), allDone());
  });
  const choose = (next: string | null) => {
    setEpic(next);
    history.replaceState(null, "", next ? `#epic=${next.slice(0, 8)}` : location.pathname);
  };
  return (
    <Errored fallback={(error) => <p class="failed">{String(error())}</p>}>
      <Loading fallback={<p class="page-loading">Reading the board…</p>}>
        <Board data={data()} onEpic={choose} allDone={allDone()} onAllDone={() => setAllDone(!allDone())} />
      </Loading>
    </Errored>
  );
}

function Board(props: { data: BoardData; onEpic: (epic: string | null) => void; allDone: boolean; onAllDone: () => void }) {
  createEffect(
    () => props.data.room,
    (room) => {
      document.title = `${room} — board`;
    },
  );
  return (
    <main class="board">
      <header class="board-head">
        <h1>{props.data.room}</h1>
        <Corner />
      </header>
      {/* everything, or one epic with open tickets: the board's views */}
      <Show when={props.data.epics.length > 0}>
        <nav class="board-views join" aria-label="Views">
          <button type="button" class={["btn btn-sm join-item", { "btn-primary": props.data.epic === null }]} onClick={() => props.onEpic(null)}>
            Everything
          </button>
          <For each={props.data.epics}>
            {(epic) => (
              <button type="button" class={["btn btn-sm join-item", { "btn-primary": props.data.epic === epic.id }]} onClick={() => props.onEpic(epic.id)} title={`${epic.open} open`}>
                {epic.title}
                <span class="badge badge-sm">{epic.open}</span>
              </button>
            )}
          </For>
        </nav>
      </Show>
      <div class="lanes">
        <For each={props.data.lanes}>
          {(lane) => {
            const yours = () => lane.stacks.flat().filter((card) => card.yours).length;
            return (
              <section class="lane">
                <h2>
                  {lane.label}
                  <Show when={yours() > 0}>
                    <span class="badge badge-soft badge-warning badge-sm">{yours()} yours</span>
                  </Show>
                </h2>
                <Show when={lane.stacks.length > 0} fallback={<p class="lane-none">none</p>}>
                  <div class="board-stacks">
                    <For each={lane.stacks}>{(stack) => <Stack cards={stack} done={lane.column === "done"} />}</For>
                  </div>
                </Show>
                <Show when={lane.column === "done" && (lane.older > 0 || props.allDone)}>
                  <p class="lane-none">
                    <Show when={!props.allDone} fallback={<button type="button" class="link link-hover" onClick={props.onAllDone}>Only the last two weeks</button>}>
                      {lane.older} older ·{" "}
                      <button type="button" class="link link-hover" onClick={props.onAllDone}>
                        show all
                      </button>
                    </Show>
                  </p>
                </Show>
              </section>
            );
          }}
        </For>
      </div>
      <Show when={props.data.unread}>{(line) => <p class="lane-none">{line()}</p>}</Show>
    </main>
  );
}

/** One line of work — what grew from what — as a stack: the latest in
 *  front, those before it behind, each offset so its title shows. The
 *  pointer over it fans it out (styles.css). */
function Stack(props: { cards: ReadonlyArray<BoardCard>; done: boolean }) {
  // drawn back to front: the latest last, in front
  const backToFront = () => [...props.cards].reverse();
  return (
    <div class={["board-stack", { stacked: props.cards.length > 1 }]} style={{ "--depth": String(props.cards.length) }}>
      <For each={backToFront()}>{(card, index) => <Card card={card} done={props.done} layer={index()} />}</For>
    </div>
  );
}

/** One ticket: its kind, its title — a review's or an investigation's opens
 *  its page — and whose it is; marked when it is the reader's now. The goal on hover. */
function Card(props: { card: BoardCard; done: boolean; layer: number }) {
  return (
    <article class={["card card-border card-sm board-card", { "board-quiet": props.done }]} style={{ "--layer": String(props.layer) }} title={props.card.goal}>
      <div class="card-body board-card-body">
        <span class={["board-kind", { epic: props.card.kind === "epic" }]} aria-label={props.card.kind}>
          {props.card.glyph}
        </span>
        <span class="board-title">
          <Show when={props.card.kind === "review" || props.card.kind === "investigation"} fallback={props.card.title}>
            <a class="link link-hover" href={ticketHref(props.card.id)}>
              {props.card.title}
            </a>
          </Show>
        </span>
        <Show when={props.card.yours}>
          <span class="badge badge-soft badge-warning badge-sm">yours</span>
        </Show>
        <span class={["board-who", { mine: props.card.mine && !props.card.dropped }]}>{props.card.dropped ? "dropped" : props.card.author}</span>
      </div>
    </article>
  );
}
