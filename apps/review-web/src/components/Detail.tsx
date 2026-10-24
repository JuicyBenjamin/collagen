import { createSignal, Show } from "solid-js";
import { Appear } from "~/components/Appear";
import { Markdown } from "~/components/Markdown";

/** A comment in full, as its AI wrote it: one step away from the short
 *  words shown, closed until the reader opens it. */
export function Detail(props: { text: string | undefined }) {
  const [open, setOpen] = createSignal(false);
  return (
    <Show when={props.text}>
      {(text) => (
        <div class="comment-detail">
          <button type="button" class="detail-toggle" aria-expanded={open() ? "true" : "false"} onClick={() => setOpen(!open())}>
            {open() ? "▾" : "▸"} In full
          </button>
          <Appear when={open() && text()}>
            {(shown) => (
              <div class="detail-body">
                <Markdown text={shown()} />
              </div>
            )}
          </Appear>
        </div>
      )}
    </Show>
  );
}
