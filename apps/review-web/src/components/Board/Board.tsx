import { createEffect, createMemo, createSignal, Errored, For, Loading, Show } from "solid-js";
import type { BoardData, BoardKind } from "~/data";
import { boardData } from "~/api";
import { Corner } from "~/components/Corner";
import { lasting } from "~/lasting";
import { overSocket } from "~/liveSocket";
import { place } from "~/place";
import { EpicPicker } from "./components/EpicPicker";
import { Kinds } from "./components/Kinds";
import { Stack } from "./components/Stack";

// The board: a room's tickets in to do, in progress and done — the
// terminal's board, columns decided by the same rule (p2p boardColumn) on
// the instance. /room/<room>/board. Read through everything or one epic,
// every kind or only some (#epic=<id>&kinds=bug,plan): epics are the views,
// not cards. What grew from what is one stack, opened with a click. Done is
// what finished lately, the rest counted. Read-only: a review's or an
// investigation's card opens its page; everything else is acted on through
// the person's agent.

/** The room whose board this is, by its short id; null on any other page. */
export const boardPlace: string | null = place?.page === "board" ? place.roomShort : null;

/** The kinds, in the order the lists use. */
const KINDS = ["investigation", "proposal", "bug", "plan", "task", "review"] as const satisfies ReadonlyArray<BoardKind>;
const isKind = (word: string): word is BoardKind => (KINDS as ReadonlyArray<string>).includes(word);

/** The view the address names: #epic=<id>&kinds=<kind>,<kind>. */
function viewInHash(): { readonly epic: string | null; readonly kinds: ReadonlyArray<BoardKind> } {
  const params = new URLSearchParams(location.hash.slice(1));
  const epic = params.get("epic");
  const named = (params.get("kinds") ?? "").split(",").filter(isKind);
  return { epic: epic !== null && /^[0-9a-f-]{8,64}$/.test(epic) ? epic : null, kinds: KINDS.filter((kind) => named.includes(kind)) };
}

async function load(roomShort: string, epic: string | null, allDone: boolean, kinds: ReadonlyArray<BoardKind>): Promise<BoardData> {
  const data = await boardData(roomShort, epic, allDone, kinds);
  if (!data) throw new Error(`no room ${roomShort} in your rooms`);
  return data;
}

export function BoardApp(props: { roomShort: string }) {
  const start = viewInHash();
  const [epic, setEpic] = createSignal<string | null>(start.epic);
  const [kinds, setKinds] = createSignal<ReadonlyArray<BoardKind>>(start.kinds);
  const [allDone, setAllDone] = createSignal(false);
  // the board's state, live over the page's socket while it is open: read again whenever it moves
  const state = createMemo(() => lasting(() => overSocket("board", props.roomShort)));
  const data = createMemo(() => {
    state();
    return load(props.roomShort, epic(), allDone(), kinds());
  });
  // the view in the address, so a reload or a copied link keeps it; given, not read back: a signal set is seen only after
  const remember = (shown: string | null, only: ReadonlyArray<BoardKind>) => {
    const view = [...(shown ? [`epic=${shown.slice(0, 8)}`] : []), ...(only.length > 0 ? [`kinds=${only.join(",")}`] : [])].join("&");
    history.replaceState(null, "", view ? `#${view}` : location.pathname);
  };
  const chooseEpic = (next: string | null) => {
    setEpic(next);
    remember(next, kinds());
  };
  const chooseKinds = (next: ReadonlyArray<BoardKind>) => {
    const only = KINDS.filter((kind) => next.includes(kind));
    setKinds(only);
    remember(epic(), only);
  };
  return (
    <Errored fallback={(error) => <p class="failed">{String(error())}</p>}>
      <Loading fallback={<p class="page-loading">Reading the board…</p>}>
        <Board data={data()} onEpic={chooseEpic} onKinds={chooseKinds} allDone={allDone()} onAllDone={() => setAllDone(!allDone())} />
      </Loading>
    </Errored>
  );
}

function Board(props: { data: BoardData; onEpic: (epic: string | null) => void; onKinds: (kinds: ReadonlyArray<BoardKind>) => void; allDone: boolean; onAllDone: () => void }) {
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
        {/* everything, or one epic with open tickets: what the board is read through */}
        <Show when={props.data.epics.length > 0}>
          <EpicPicker epics={props.data.epics} chosen={props.data.epic} onChoose={props.onEpic} />
        </Show>
        <Kinds kinds={props.data.kinds} chosen={props.data.chosen} onChange={props.onKinds} />
        <Corner />
      </header>
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
                    {/* keyed by the line's latest card: a stack keeps its own state while the board refreshes under it */}
                    <For each={lane.stacks} keyed={(stack) => stack[0]!.id}>
                      {(stack) => <Stack cards={stack()} done={lane.column === "done"} />}
                    </For>
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
