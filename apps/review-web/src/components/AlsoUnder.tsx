import { For, onCleanup, Show } from "solid-js";
import { NO_TITLE, type Decision } from "../data";

/** A decision's title cut to fit one line of the file header. */
const short = (what: string) => (what.length > 48 ? `${what.slice(0, 47)}…` : what);

/** The same code serves more than one decision: say which, and go there.
 *  One other is named outright; several open as a list, one decision a
 *  line, each a link to its section. */
export function AlsoUnder(props: { decisions: ReadonlyArray<Decision> }) {
  let menu: HTMLDetailsElement | undefined;
  const close = () => menu?.removeAttribute("open");
  return (
    <Show when={props.decisions.length > 0}>
      <Show
        when={props.decisions.length > 1}
        fallback={
          <a class="also" href={`#${props.decisions[0]!.id}`}>
            also under “{short(props.decisions[0]!.title ?? NO_TITLE)}”
          </a>
        }
      >
        <details
          class="also-menu"
          ref={(el) => {
            menu = el;
            // a click anywhere else folds it
            const away = (e: MouseEvent) => !el.contains(e.target as Node) && close();
            document.addEventListener("click", away);
            onCleanup(() => document.removeEventListener("click", away));
          }}
        >
          <summary class="also">also under {props.decisions.length} other decisions</summary>
          <ul>
            <For each={props.decisions}>
              {(d) => (
                <li>
                  <a href={`#${d.id}`} onClick={close}>
                    {d.title ?? NO_TITLE}
                  </a>
                </li>
              )}
            </For>
          </ul>
        </details>
      </Show>
    </Show>
  );
}
