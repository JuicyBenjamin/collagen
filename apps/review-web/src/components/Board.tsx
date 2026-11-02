import { createEffect, createMemo, Errored, For, Loading, Show } from "solid-js";
import type { BoardCard, BoardData } from "~/data";
import { boardData } from "~/api";
import { Corner } from "~/components/Corner";
import { lasting } from "~/lasting";
import { overSocket } from "~/liveSocket";
import { place, ticketHref } from "~/place";

// The board: a room's tickets in to do, in progress and done — the
// terminal's board, columns decided by the same rule (p2p boardColumn) on
// the instance. /room/<room>/board. Read-only: a review's or an
// investigation's card opens its page; everything else is acted on through
// the person's agent.

/** The room whose board this is, by its short id; null on any other page. */
export const boardPlace: string | null = place?.page === "board" ? place.roomShort : null;

async function load(roomShort: string): Promise<BoardData> {
  const data = await boardData(roomShort);
  if (!data) throw new Error(`no room ${roomShort} in your rooms`);
  return data;
}

export function BoardApp(props: { roomShort: string }) {
  // the board's state, live over the page's socket while it is open: read again whenever it moves
  const state = createMemo(() => lasting(() => overSocket("board", props.roomShort)));
  const data = createMemo(() => {
    state();
    return load(props.roomShort);
  });
  return (
    <Errored fallback={(error) => <p class="failed">{String(error())}</p>}>
      <Loading fallback={<p class="page-loading">Reading the board…</p>}>
        <Board data={data()} />
      </Loading>
    </Errored>
  );
}

function Board(props: { data: BoardData }) {
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
      <div class="lanes">
        <For each={props.data.lanes}>
          {(lane) => {
            const yours = () => lane.cards.filter((card) => card.yours).length;
            return (
              <section class="lane">
                <h2>
                  {lane.label}
                  <Show when={yours() > 0}>
                    <span class="badge badge-soft badge-warning badge-sm">{yours()} yours</span>
                  </Show>
                </h2>
                <Show when={lane.cards.length > 0} fallback={<p class="lane-none">none</p>}>
                  <ul class="list bg-base-200 rounded-box">
                    <For each={lane.cards}>{(card) => <Card card={card} done={lane.column === "done"} />}</For>
                  </ul>
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

/** One ticket: its kind, its title — a review's or an investigation's opens
 *  its page — and whose it is; marked when it is the reader's now. The goal on hover. */
function Card(props: { card: BoardCard; done: boolean }) {
  return (
    <li class={["list-row", { "board-quiet": props.done }]} title={props.card.goal}>
      <span class={["board-kind", { epic: props.card.kind === "epic" }]} aria-label={props.card.kind}>
        {props.card.glyph}
      </span>
      <span class="list-col-grow board-title">
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
    </li>
  );
}
