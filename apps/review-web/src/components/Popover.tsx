import { createMemo, For, Show } from "solid-js";
import { highlightCode } from "../highlight";
import { brief, inline } from "../hoverText";
import { popover, toolNameFor } from "../intel";
import { CodeLine } from "./Code";

/** Prose from a hover, its little markdown as elements (hoverText.inline).
 *  Text stays text. */
function Prose(props: { text: string }) {
  return (
    <p class="hint-text">
      <For each={inline(props.text)}>{(p) => ("code" in p ? <code>{p.code}</code> : "strong" in p ? <strong>{p.strong}</strong> : p.text)}</For>
    </p>
  );
}

/** The type of what the pointer rests on, beside the pointer. */
export function Popover() {
  const style = createMemo(() => {
    const p = popover();
    if (!p) return {};
    // beside the pointer, kept on screen
    const left = Math.min(p.x + 14, innerWidth - 520);
    const below = p.y + 18;
    return below > innerHeight - 160 ? { left: `${Math.max(8, left)}px`, bottom: `${innerHeight - p.y + 10}px` } : { left: `${Math.max(8, left)}px`, top: `${below}px` };
  });
  return (
    <Show when={popover()}>
      {(p) => (
        <div class="hint" style={style()} role="tooltip">
          <Show when={p().state === "ready" && p().result} fallback={<p class="hint-text">Starting {toolNameFor(p().file)}…</p>}>
            {(r) => (
              <Show when={"markdown" in r() ? (r() as { markdown: string }).markdown : null} fallback={<p class="hint-text muted">{"error" in r() ? (r() as { error: string }).error : ""}</p>}>
                {(md) => (
                  <>
                  <For each={brief(md()).blocks}>
                    {(b) =>
                      "label" in b ? (
                        <p class="hint-label">{b.label}</p>
                      ) : "code" in b ? (
                        <pre class="hint-code">
                          <For each={highlightCode(b.code, b.lang)}>
                            {(line) => (
                              <div>
                                <CodeLine spans={line} />
                              </div>
                            )}
                          </For>
                        </pre>
                      ) : (
                        <Prose text={b.text} />
                      )
                    }
                  </For>
                  <Show when={brief(md()).overloads > 0}>
                    <p class="hint-text muted">+{brief(md()).overloads} {brief(md()).overloads === 1 ? "overload" : "overloads"}</p>
                  </Show>
                  </>
                )}
              </Show>
            )}
          </Show>
        </div>
      )}
    </Show>
  );
}
