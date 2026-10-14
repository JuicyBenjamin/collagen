import { createSignal, Loading, onCleanup, Show, type Element } from "solid-js";

// A part of the page that waits on data: its own placeholder (the part's
// markup, its words masked — `Foo.Skeleton`) stands where it will be until
// the part's own data is in, then lies over the part and is swept away from
// the top left to the bottom right. Each part on its own, the moment it is
// ready: nothing waits for a slower part. The placeholder never goes first,
// so a part shows no blank frame between the two. A part whose data is
// already in when it is placed (kept from the last visit) just shows. None
// of the sweep when the reader asks their system for less motion.

const still = matchMedia("(prefers-reduced-motion: reduce)");
/** As long as the sweep runs (styles.css: arrives-ghost). */
const SWEEP_MS = 600;

export function Arrives(props: {
  /** the part's placeholder, drawn while it waits and swept off it after */
  skeleton: () => Element;
  /** what the part waits on besides a read (a flag, a value set later):
   *  the placeholder stands while it is false */
  ready?: boolean;
  /** sits in a line of others (the host's bar), not a block of its own */
  inline?: boolean;
  children: Element;
}) {
  const [sweeping, setSweeping] = createSignal(false);
  const sweep = () => {
    if (still.matches) return;
    setSweeping(true);
    // a tab out of sight runs no animation: it ends on time anyway
    setTimeout(() => setSweeping(false), SWEEP_MS + 150);
  };
  /** The placeholder while the part's read is out: as it goes, the part is
   *  in, and the same placeholder is laid over it in the same moment. */
  const Reading = () => {
    onCleanup(() => {
      // read, but not ready yet: the next placeholder stands
      if (props.ready !== false) sweep();
    });
    return props.skeleton();
  };
  /** The placeholder while the part is read but not ready. */
  let stood = false;
  const Standing = () => {
    stood = true;
    return props.skeleton();
  };
  /** The part, made as it is ready: a placeholder stood for it, so the
   *  same sweep, laid over it as it is made. */
  const Ready = () => {
    if (stood) sweep();
    return props.children;
  };
  return (
    <div class={["arrives", { inline: props.inline }]}>
      <Loading fallback={<Reading />}>
        <Show when={props.ready ?? true} fallback={<Standing />}>
          <Ready />
        </Show>
      </Loading>
      <Show when={sweeping()}>
        <div class="arrives-ghost" aria-hidden="true" onAnimationEnd={() => setSweeping(false)}>
          {props.skeleton()}
        </div>
      </Show>
    </div>
  );
}
