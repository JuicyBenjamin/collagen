import { createMemo, For, Show } from "solid-js";
import { highlightCode } from "../highlight";
import { readSoFar, stillReading, type HoverResult } from "../data";
import { brief, inline } from "../hoverText";
import { popover, toolNameFor } from "../intel";
import { CodeLine } from "./Code";

/** Prose from a hover, its little markdown as elements (hoverText.inline).
 *  Text stays text. */
function Prose(props: { text: string }) {
  return (
    <p class="hint-text">
      <For each={inline(props.text)}>{(part) => ("code" in part ? <code>{part.code}</code> : "strong" in part ? <strong>{part.strong}</strong> : part.text)}</For>
    </p>
  );
}

/** "Intelephense is reading the project · 40%" — why an answer may be
 *  missing things; the page asks again by itself until it is whole. */
const reading = (name: string, result: HoverResult): string => {
  const at = readSoFar(result);
  return `${name} is reading the project${at === null ? "…" : ` · ${at}%`}`;
};

/** The type of what the pointer rests on, beside the pointer. */
export function Popover() {
  const style = createMemo(() => {
    const hovered = popover();
    if (!hovered) return {};
    // beside the pointer, kept on screen
    const left = Math.min(hovered.x + 14, innerWidth - 520);
    const below = hovered.y + 18;
    return below > innerHeight - 160 ? { left: `${Math.max(8, left)}px`, bottom: `${innerHeight - hovered.y + 10}px` } : { left: `${Math.max(8, left)}px`, top: `${below}px` };
  });
  return (
    <Show when={popover()}>
      {(hovered) => (
        <div class="hint" style={style()} role="tooltip">
          <Show when={hovered().state === "ready" && hovered().result} fallback={<p class="hint-text">Starting {toolNameFor(hovered().file)}…</p>}>
            {(result) => (
              <Show when={"markdown" in result() ? (result() as { markdown: string }).markdown : null} fallback={
                  <p class="hint-text muted">
                    {"none" in result()
                      ? reading(toolNameFor(hovered().file), result())
                      : "error" in result()
                        ? (result() as { error: string }).error
                        : ""}
                  </p>
                }>
                {(markdown) => (
                  <>
                  <For each={brief(markdown()).blocks}>
                    {(block) =>
                      "label" in block ? (
                        <p class="hint-label">{block.label}</p>
                      ) : "code" in block ? (
                        <pre class="hint-code">
                          <For each={highlightCode(block.code, block.lang)}>
                            {(line) => (
                              <div>
                                <CodeLine spans={line} />
                              </div>
                            )}
                          </For>
                        </pre>
                      ) : (
                        <Prose text={block.text} />
                      )
                    }
                  </For>
                  <Show when={stillReading(result())}>
                    <p class="hint-text muted">May be incomplete — {reading(toolNameFor(hovered().file), result())}</p>
                  </Show>
                  <Show when={brief(markdown()).overloads > 0}>
                    <p class="hint-text muted">+{brief(markdown()).overloads} {brief(markdown()).overloads === 1 ? "overload" : "overloads"}</p>
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
