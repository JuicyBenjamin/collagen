import { createSignal } from "solid-js";
import { Appear } from "~/components/Appear";

/** The full findings, folded beneath an answer: opened on the reader's click. */
export function More(props: { text: string }) {
  const [open, setOpen] = createSignal(false);
  return (
    <div class="inv-more">
      <button type="button" class="inv-more-toggle" aria-expanded={open() ? "true" : "false"} onClick={() => setOpen(!open())}>
        Full findings
        <svg class={["inv-caret", { open: open() }]} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <Appear when={open()}>{() => <p class="inv-plain">{props.text}</p>}</Appear>
    </div>
  );
}
