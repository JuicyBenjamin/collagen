import { For, Show } from "solid-js";
import type { Fork as ForkData } from "~/data";
import { animateDetails } from "~/fold";
import { wide } from "~/wide";
import { Fork } from "../../Fork";

/** Forks no unit holds, under a heading of their own: nothing when there are none. */
export function Forks(props: { title: string; forks: ReadonlyArray<ForkData> }) {
  return (
    <Show when={props.forks.length > 0}>
      <section class="decision">
        <div class="decision-head">
          <h2>{props.title}</h2>
        </div>
        <div class="decision-main" />
        <details class="why" open={wide()} ref={animateDetails}>
          <summary>Why</summary>
          <div>
            <For each={props.forks}>{(fork) => <Fork fork={fork} />}</For>
          </div>
        </details>
      </section>
    </Show>
  );
}
