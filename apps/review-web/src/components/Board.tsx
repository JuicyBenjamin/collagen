import { createEffect, createMemo, Errored, For, Loading, Show } from "solid-js";
import type { BoardCard, BoardData } from "../data";
import { boardChanges, boardData } from "../api";
import { lasting } from "../lasting";

// The board: a room's tickets in to do, in progress and done — the
// terminal's board, columns decided by the same rule (p2p boardColumn) on
// the instance. /board/<short room id>. Read-only: a review's card opens its
// page; everything else is acted on through the person's agent.

/** /board/<short room id> — the one thing the url carries. */
const roomId = decodeURIComponent(location.pathname.split("/").filter(Boolean)[1] ?? "");

/** Is this page the board? */
export const onBoard = (): boolean => location.pathname.startsWith("/board/");

async function load(): Promise<BoardData> {
  const data = await boardData(roomId);
  if (!data) throw new Error(`no room ${roomId} in your rooms`);
  return data;
}

export function BoardApp() {
  // the board's state, live while the page is open: read again whenever it moves
  const state = createMemo(() => lasting(() => boardChanges(roomId)));
  const data = createMemo(() => {
    state();
    return load();
  });
  return (
    <Errored fallback={(error) => <p class="failed">{String(error())}</p>}>
      <Loading fallback={<p class="loading">Reading the board…</p>}>
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
    <div class="board">
      <h1>{props.data.room}</h1>
      <div class="lanes">
        <For each={props.data.lanes}>
          {(lane) => {
            const yours = () => lane.cards.filter((card) => card.yours).length;
            return (
              <section class="lane">
                <h2>
                  {lane.label}
                  <Show when={yours() > 0}>
                    <span class="lane-yours">▸ {yours()}</span>
                  </Show>
                </h2>
                <Show when={lane.cards.length > 0} fallback={<p class="lane-none">none</p>}>
                  <ol>
                    <For each={lane.cards}>{(card) => <Card card={card} done={lane.column === "done"} />}</For>
                  </ol>
                </Show>
              </section>
            );
          }}
        </For>
      </div>
      <Show when={props.data.unread}>{(line) => <p class="lane-none">{line()}</p>}</Show>
    </div>
  );
}

/** One ticket: its kind, its title — a review's opens its page — and whose
 *  it is; ▸ when it is the reader's now. The goal on hover. */
function Card(props: { card: BoardCard; done: boolean }) {
  return (
    <li class={["card", { yours: props.card.yours, quiet: props.done, epic: props.card.kind === "epic" }]} title={props.card.goal}>
      <span class="card-kind" aria-label={props.card.kind}>
        {props.card.glyph}
      </span>
      <span class="card-title">
        <Show when={props.card.kind === "review"} fallback={props.card.title}>
          <a href={`/review/${encodeURIComponent(props.card.id)}`}>{props.card.title}</a>
        </Show>
      </span>
      <span class={["card-who", { mine: props.card.mine && !props.card.dropped }]}>{props.card.dropped ? "dropped" : props.card.author}</span>
    </li>
  );
}
