import { createEffect, createSignal, Loading, Show, type Accessor, type Element } from "solid-js";
import { enter, leave } from "~/fold";

// What a condition shows and hides: it opens into place as it comes and
// closes before it is taken away, so what follows it slides rather than
// jumps. Held placed through its exit, with the last value it had; shown
// again at once if the condition comes back meanwhile. The condition waits
// on its own reads (the host, the room): nothing around it waits with it.
// What is there when the page is first drawn just shows (fold.ts skips it
// all for less motion).

/** Has the page been drawn: what is placed after it is an arrival. */
let drawn = false;
const done = () => (drawn = true);
requestAnimationFrame(done);
// a tab out of sight draws no frames
setTimeout(done, 200);

export function Appear<Value>(props: {
  when: Value | undefined | null | false;
  children: (value: Accessor<Value>) => Element;
}) {
  return (
    <Loading>
      <Toggled when={props.when}>{props.children}</Toggled>
    </Loading>
  );
}

/** The condition read inside the boundary, its element entering and leaving. */
function Toggled<Value>(props: {
  when: Value | undefined | null | false;
  children: (value: Accessor<Value>) => Element;
}) {
  // boxed: a value may itself be a function, which a signal would call
  const [shown, setShown] = createSignal<{ readonly value: Value } | null>(
    props.when ? { value: props.when } : null,
  );
  let element: HTMLElement | undefined;
  let leaving = false;
  createEffect(
    () => props.when,
    (when) => {
      if (when) {
        // back while it was closing: it opens again where it is
        if (leaving && element) enter(element);
        leaving = false;
        return void setShown({ value: when });
      }
      if (!element) return void setShown(null);
      leaving = true;
      void leave(element).then(() => {
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
            if (drawn) enter(placed);
          }}
        >
          {props.children(() => box().value)}
        </div>
      )}
    </Show>
  );
}
