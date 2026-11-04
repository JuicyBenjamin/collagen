import { Show } from "solid-js";
import type { BoardCard } from "~/data";
import { ticketHref } from "~/place";

/** One ticket: its kind, its title — a review's or an investigation's opens
 *  its page — and whose it is; marked when it is the reader's now. The goal on hover. */
export function Card(props: { card: BoardCard; done: boolean }) {
  return (
    <article class={["card card-border card-sm board-card", { "board-quiet": props.done }]} title={props.card.goal}>
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
