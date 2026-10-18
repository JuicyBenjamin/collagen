import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import type { Machine as MachineData, MachineVersion } from "~/data";
import { Actor } from "./components/Actor";
import { Controls } from "./components/Controls";
import { Moves } from "./components/Moves";
import { Sources } from "./components/Sources";
import { State } from "./components/State";
import { GAP, HEAD, LANE, ROW, TOP, type Stage } from "./stage";

/** How long each beat of the walk-through holds. */
const BEAT_MS = 2400;
/** The sources' column, when there are any. */
const SOURCES = 170;

/** How the change works: its states drawn once, the things running it moving
 *  through them beat by beat as what they wait on comes, each beat said in a
 *  line beneath. When the change altered a machine that was there, the
 *  version before it too, with what the change took out and put in marked. */
export function Machine(props: { machine: MachineData }) {
  const [shown, setShown] = createSignal<"now" | "before">("now");
  const [beat, setBeat] = createSignal(0);
  const [paused, setPaused] = createSignal(false);
  // starting over jumps back to the start rather than sliding there
  const [still, setStill] = createSignal(true);
  const settle = () => requestAnimationFrame(() => requestAnimationFrame(() => setStill(false)));
  settle();
  const restart = () => {
    setStill(true);
    setBeat(0);
    settle();
  };
  const version = (): MachineVersion => (shown() === "before" && props.machine.before) || props.machine.now;
  const other = (): MachineVersion | undefined => (shown() === "before" ? props.machine.now : props.machine.before);
  // past the last beat it holds the end once, then plays again
  const ticking = setInterval(() => {
    if (paused()) return;
    if (beat() >= version().play.length) restart();
    else setBeat(beat() + 1);
  }, BEAT_MS);
  onCleanup(() => clearInterval(ticking));

  const held = () => beat() >= version().play.length;
  // where everything is after this beat, and the moves this beat took
  const walk = createMemo(() => {
    const play = version().play;
    const at = Math.min(beat(), play.length - 1);
    const where = new Map(props.machine.actors.map((actor) => [actor.id, actor.starts]));
    const taken: Array<string> = [];
    play.slice(0, at + 1).forEach((step, index) => {
      for (const move of step.moves ?? []) {
        if (index === at) taken.push(`${where.get(move.actor)}>${move.to}`);
        where.set(move.actor, move.to);
      }
    });
    return { where, taken, step: play[at], at };
  });
  // what each thing waits on next: the source of the next beat that moves it
  const needs = (actor: string) => {
    const play = version().play;
    const coming = play.slice(walk().at + (held() ? 1 : 0)).find((step) => step.from !== undefined && (step.moves ?? []).some((move) => move.actor === actor));
    return coming?.from;
  };
  const nameOf = (source: string | undefined) => props.machine.sources.find((candidate) => candidate.id === source)?.name;
  const columnOf = () => new Map(version().states.map((state, index) => [state.id, index]));
  const stage = (): Stage => ({ columns: version().states.length, start: props.machine.sources.length > 0 ? SOURCES + GAP : 0 });
  const height = () => HEAD + props.machine.actors.length * ROW + 8;
  const routes = () => version().moves.filter((move) => columnOf().get(move.to) !== (columnOf().get(move.from) ?? 0) + 1 && move.from !== move.to).length;
  const tall = () => Math.max(TOP + height() + (routes() > 0 ? 20 + routes() * LANE : 0), TOP + props.machine.sources.length * 84) + 8;
  // against the other version: what this one has that it lacks
  const change = (has: boolean): "new" | "removed" | undefined => (has || !other() ? undefined : shown() === "now" ? "new" : "removed");
  const giving = () => (held() ? undefined : walk().step?.from);
  const moving = (actor: string) => !held() && (walk().step?.moves ?? []).some((move) => move.actor === actor);

  return (
    <section class="machine" aria-label="How it works">
      <div class="machine-head">
        <div>
          <h2 class="machine-title">{props.machine.title}</h2>
          <p class="machine-summary">{props.machine.summary}</p>
        </div>
        <Controls
          changed={props.machine.before !== undefined}
          shown={shown()}
          onShow={(next) => {
            setShown(next);
            restart();
          }}
          paused={paused()}
          onPause={() => setPaused(!paused())}
          onReplay={restart}
        />
      </div>
      <div class="machine-scroll">
        <div
          class={{ "machine-stage": true, still: still() }}
          style={{ height: `${tall()}px`, "min-width": `${stage().start + stage().columns * 150 + (stage().columns - 1) * GAP}px` }}
        >
          <Sources sources={props.machine.sources} giving={giving()} width={SOURCES} />
          <For each={version().states}>
            {(state, index) => (
              <State
                state={state}
                column={index()}
                stage={stage()}
                height={height()}
                change={change(other()?.states.some((candidate) => candidate.id === state.id) ?? true)}
              />
            )}
          </For>
          <Moves
            moves={version().moves.map((move) => ({
              ...move,
              lit: !held() && walk().taken.includes(`${move.from}>${move.to}`),
              change: change(other()?.moves.some((candidate) => candidate.from === move.from && candidate.to === move.to) ?? true),
            }))}
            columnOf={columnOf()}
            stage={stage()}
            bottom={TOP + height()}
          />
          <For each={props.machine.actors}>
            {(actor, row) => (
              <Actor
                name={actor.name}
                column={columnOf().get(walk().where.get(actor.id) ?? actor.starts) ?? 0}
                row={row()}
                stage={stage()}
                moving={moving(actor.id)}
                needs={nameOf(needs(actor.id))}
                asked={giving() !== undefined && giving() === needs(actor.id)}
              />
            )}
          </For>
        </div>
      </div>
      <p class="machine-says">{walk().step?.says}</p>
      <div class="machine-legend">
        <span class="machine-key now">happening now</span>
        <Show when={props.machine.before && shown() === "before"}>
          <span class="machine-key removed">what this change removes</span>
        </Show>
        <Show when={props.machine.before && shown() === "now"}>
          <span class="machine-key">
            <span class="machine-tag new">new</span> what this change adds
          </span>
        </Show>
      </div>
    </section>
  );
}
