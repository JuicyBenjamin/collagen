import { createEffect, createSignal, Loading, Show, type Accessor, type Element } from "solid-js";
import { enter, enterSideways, leave, leaveSideways } from "~/fold";

// What a condition shows and hides: it opens into place as it comes and
// closes before it is taken away, so what follows it slides rather than
// jumps. Held placed through its exit, with the last value it had; shown
// again at once if the condition comes back meanwhile. The condition waits
// on its own reads (the host, the room): nothing around it waits with it.
// What is there when the page is first drawn just shows, and so does what
// comes as part of a part arriving: that part's sweep brings it (fold.ts
// skips it all for less motion).

/** Has the page been drawn: what is placed after it is an arrival. */
let drawn = false;
const done = () => (drawn = true);
requestAnimationFrame(done);
// a tab out of sight draws no frames
setTimeout(done, 200);

/** How it comes and goes: opening down (height), or, in a row of things
 *  side by side, opening across (width). */
export type Way = "down" | "across";
const WAYS: Record<Way, { readonly enter: (element: HTMLElement) => void; readonly leave: (element: HTMLElement | undefined) => Promise<void> }> = {
  down: { enter, leave },
  across: { enter: enterSideways, leave: leaveSideways },
};

export function Appear<Value>(props: {
  when: Value | undefined | null | false;
  /** how it opens: down by default, across in a row of things side by side */
  way?: Way;
  children: (value: Accessor<Value>) => Element;
}) {
  // made after the page was drawn: it came with a part that arrived, and
  // what it shows at first arrives with that part
  const quiet = drawn;
  return (
    <Loading>
      <Toggled when={props.when} quiet={quiet} way={WAYS[props.way ?? "down"]}>
        {props.children}
      </Toggled>
    </Loading>
  );
}

/** The condition read inside the boundary, its element entering and leaving. */
function Toggled<Value>(props: {
  when: Value | undefined | null | false;
  /** what it shows at first came with an arriving part: no entrance of its own */
  quiet: boolean;
  way: (typeof WAYS)[Way];
  children: (value: Accessor<Value>) => Element;
}) {
  // boxed: a value may itself be a function, which a signal would call
  const [shown, setShown] = createSignal<{ readonly value: Value } | null>(
    props.when ? { value: props.when } : null,
  );
  let element: HTMLElement | undefined;
  let leaving = false;
  let first = true;
  createEffect(
    () => props.when,
    (when) => {
      if (when) {
        // back while it was closing: it opens again where it is
        if (leaving && element) props.way.enter(element);
        leaving = false;
        return void setShown({ value: when });
      }
      if (!element) return void setShown(null);
      leaving = true;
      void props.way.leave(element).then(() => {
        if (!leaving) return;
        leaving = false;
        element = undefined;
        setShown(null);
      });
    },
  );
  return (
    <Show when={shown()}>
      {(box) => (
        <div
          class="appear"
          ref={(placed) => {
            element = placed;
            if (drawn && !(first && props.quiet)) props.way.enter(placed);
            first = false;
          }}
        >
          {props.children(() => box().value)}
        </div>
      )}
    </Show>
  );
}
