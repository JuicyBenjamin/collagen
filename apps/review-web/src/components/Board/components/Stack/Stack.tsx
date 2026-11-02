import { createEffect, createSignal, For, Show } from "solid-js";
import type { BoardCard } from "~/data";
import { Card } from "./components/Card";
import { lift, spread, STEP } from "./fan";

/** What came before the latest in a line of work, in a few words. */
const earlierLine = (earlier: ReadonlyArray<BoardCard>): string =>
  earlier.length === 1 ? `+1 earlier: ${earlier[0]!.title}` : `+${earlier.length} earlier: ${earlier[0]!.title} and ${earlier.length - 1} more`;

/** One line of work — what grew from what. At rest its latest card, the
 *  edges of those before it under it, and what they are in a line; the
 *  pointer over it lifts it a little, as it does any card. A click opens it
 *  from the middle, as many cards above where it stands as below, over the
 *  board and taking no room, so nothing moves under the pointer: every card
 *  alike, the one in focus (pointed at, or reached with the arrows) a touch
 *  larger (fan.ts). It folds when the pointer or focus leaves it, on
 *  Escape, or another click. */
export function Stack(props: { cards: ReadonlyArray<BoardCard>; done: boolean }) {
  const [open, setOpen] = createSignal(false);
  const [focus, setFocus] = createSignal(0);
  const [over, setOver] = createSignal(false);
  const many = () => props.cards.length > 1;
  let face: HTMLDivElement | undefined;
  let edges: HTMLDivElement | undefined;
  let fan: HTMLDivElement | undefined;
  let shade: HTMLDivElement | undefined;
  const parts = () => (face && edges && fan && shade ? { face, edges, fan, shade } : null);
  createEffect(
    () => [open(), focus(), props.cards.length] as const,
    ([isOpen, at]) => {
      const now = parts();
      if (now) spread(now, isOpen, at);
    },
  );
  createEffect(
    () => over() && !open(),
    (lifted) => {
      if (face) lift(face, edges, lifted);
    },
  );
  const close = () => {
    setOpen(false);
    setFocus(0);
  };
  const toggle = () => {
    if (!many()) return;
    setFocus(0);
    setOpen(!open());
  };
  const key = (event: KeyboardEvent) => {
    if (!many() || (event.target as Element).closest("a")) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggle();
    } else if (event.key === "Escape") close();
    else if (open() && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      setFocus(Math.max(0, Math.min(props.cards.length - 1, focus() + (event.key === "ArrowDown" ? 1 : -1))));
    }
  };
  return (
    <div
      class={["board-stack", { stacked: many(), open: open() }]}
      style={{ "--mid": String((props.cards.length - 1) / 2), "--step": `${STEP}px` }}
      onClick={(event) => {
        // a review's or an investigation's title is a link: it opens its page, not the stack
        if (!(event.target as Element).closest("a")) toggle();
      }}
      onKeyDown={key}
      onPointerEnter={() => setOver(true)}
      onPointerLeave={() => {
        setOver(false);
        close();
      }}
      onFocusOut={(event) => {
        // focus gone elsewhere on the page (Tab); a click inside leaves it nowhere, and the pointer closes it then
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) close();
      }}
    >
      <div class="board-stack-front">
        <div ref={face} class="board-stack-face" role={many() ? "button" : undefined} tabindex={many() ? "0" : undefined} aria-expanded={many() ? (open() ? "true" : "false") : undefined}>
          <Card card={props.cards[0]!} done={props.done} />
        </div>
        <Show when={many()}>
          <div ref={fan} class="board-stack-fan" role="list" aria-label="This line of work" aria-hidden={open() ? "false" : "true"}>
            <For each={props.cards} keyed={(card) => card.id}>
              {(card, index) => (
                <div role="listitem" class={["board-stack-item", { focused: index() === focus() }]} onPointerEnter={() => setFocus(index())}>
                  <Card card={card()} done={props.done} />
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
      <Show when={many()}>
        {/* the board shaded back while the stack is open; the pointer goes through it, so leaving the stack still folds it */}
        <div ref={shade} class="board-stack-shade" aria-hidden="true" />
        <div ref={edges} class="board-stack-edges" aria-hidden="true">
          <For each={props.cards.slice(1, 3)}>{() => <span />}</For>
        </div>
        <p class="board-stack-more">{earlierLine(props.cards.slice(1))}</p>
      </Show>
    </div>
  );
}
