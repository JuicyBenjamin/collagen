import { For, Show } from "solid-js";
import { across, columnMiddle, GAP, gapLeft, LANE, TOP, type Stage } from "../stage";

interface Move {
  readonly from: string;
  readonly to: string;
  readonly on: string;
  readonly change?: "new" | "removed";
  readonly lit: boolean;
}

/** The moves between states: one to the next state is an arrow across the
 *  gap, its label above; one that skips a state or goes back runs on a
 *  route of its own below the states, its label on the route. */
export function Moves(props: { moves: ReadonlyArray<Move>; columnOf: ReadonlyMap<string, number>; stage: Stage; bottom: number }) {
  const column = (state: string) => props.columnOf.get(state) ?? 0;
  const next = () => props.moves.filter((move) => column(move.to) === column(move.from) + 1);
  const routed = () => props.moves.filter((move) => column(move.to) !== column(move.from) + 1 && move.from !== move.to);
  const kind = (move: Move) => ({ lit: move.lit, removed: move.change === "removed" });
  return (
    <>
      <For each={next()}>
        {(move) => (
          <>
            <span class={{ "machine-move-label": true, ...kind(move) }} style={{ left: `calc(${gapLeft(props.stage, column(move.from))} + ${GAP / 2}px)`, top: "4px" }}>
              {move.on}
              <Show when={move.change === "new"}>
                <span class="machine-tag new">new</span>
              </Show>
            </span>
            <span class={{ "machine-arrow": true, ...kind(move) }} style={{ left: gapLeft(props.stage, column(move.from)), top: `${TOP + 24}px`, width: `${GAP - 4}px` }} />
          </>
        )}
      </For>
      <For each={routed()}>
        {(move, lane) => {
          const from = () => column(move.from);
          const to = () => column(move.to);
          const low = () => props.bottom + 20 + lane() * LANE;
          const left = () => Math.min(from(), to());
          return (
            <>
              <span class={{ "machine-route down": true, ...kind(move) }} style={{ left: columnMiddle(props.stage, from()), top: `${props.bottom}px`, height: `${low() - props.bottom}px` }} />
              <span class={{ "machine-route across": true, ...kind(move) }} style={{ left: columnMiddle(props.stage, left()), top: `${low()}px`, width: across(props.stage, Math.abs(to() - from())) }} />
              <span class={{ "machine-route up": true, ...kind(move) }} style={{ left: columnMiddle(props.stage, to()), top: `${props.bottom + 2}px`, height: `${low() - props.bottom - 2}px` }} />
              <span
                class={{ "machine-move-label": true, ...kind(move) }}
                style={{ left: `calc(${columnMiddle(props.stage, left())} + ${across(props.stage, Math.abs(to() - from()))} / 2)`, top: `${low() - 19}px` }}
              >
                {move.on}
                <Show when={move.change}>
                  {(change) => <span class={`machine-tag ${change()}`}>{change()}</span>}
                </Show>
              </span>
            </>
          );
        }}
      </For>
    </>
  );
}
