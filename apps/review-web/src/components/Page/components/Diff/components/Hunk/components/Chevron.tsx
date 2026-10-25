import { animate } from "motion";
import { createEffect } from "solid-js";
import { turnChevron } from "~/fold";

/** A viewed file's chevron: one triangle that turns — right, folded; down,
 *  open again to read — swinging round on a spring when it changes, set at
 *  once when it is first drawn. */
export function Chevron(props: { open: boolean }) {
  let chevron: HTMLSpanElement | undefined;
  let drawn = false;
  createEffect(
    () => props.open,
    (open) => {
      if (!chevron) return;
      // set at once when drawn, through Motion too, so a later turn starts from where it is
      if (drawn) turnChevron(chevron, open);
      else void animate(chevron, { rotate: open ? 90 : 0 }, { duration: 0 });
      drawn = true;
    },
  );
  return (
    <span class="chevron" aria-hidden="true" ref={(element) => (chevron = element)}>
      ▸
    </span>
  );
}
