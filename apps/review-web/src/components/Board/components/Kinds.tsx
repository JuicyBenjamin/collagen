import { For } from "solid-js";
import type { BoardData, BoardKind } from "~/data";

/** The kinds the board can be filtered to, each a toggle with how many
 *  it shows: none on is every kind; some on, only those. */
export function Kinds(props: { kinds: BoardData["kinds"]; chosen: ReadonlyArray<BoardKind>; onChange: (kinds: ReadonlyArray<BoardKind>) => void }) {
  return (
    <div class="board-kinds" role="group" aria-label="Kinds">
      <For each={props.kinds}>
        {(kind) => {
          const on = () => props.chosen.includes(kind.kind);
          return (
            <button
              type="button"
              class={["btn btn-sm btn-soft", { "btn-primary": on() }]}
              aria-pressed={on() ? "true" : "false"}
              onClick={() => props.onChange(on() ? props.chosen.filter((chosen) => chosen !== kind.kind) : [...props.chosen, kind.kind])}
            >
              <span aria-hidden="true">{kind.glyph}</span>
              {kind.label}
              <span class="board-kind-count">{kind.count}</span>
            </button>
          );
        }}
      </For>
    </div>
  );
}
