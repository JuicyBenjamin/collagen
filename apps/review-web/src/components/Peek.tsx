import { For, Show } from "solid-js";
import type { DefinitionResult, Peek as PeekData } from "../data";
import { highlightCode } from "../highlight";
import { closePeek } from "../intel";
import { CodeLine } from "./Code";

const WHERE: Record<PeekData["where"], string> = { branch: "", package: "package", typescript: "built into TypeScript" };

/** Where a symbol is declared, opened under the line it was clicked on: the
 *  declaration itself, coloured, with its file and line; a package's types
 *  say so; TypeScript's own library names the file it lives in. */
export function Peek(props: { result: DefinitionResult | null }) {
  return (
    <div class="peek">
      <button class="peek-close" type="button" aria-label="Close" onClick={() => closePeek()}>
        ×
      </button>
      <Show when={props.result} fallback={<p class="peek-note">Finding the definition…</p>}>
        {(r) => (
          <Show when={"peeks" in r() ? (r() as { peeks: ReadonlyArray<PeekData> }).peeks : null} fallback={<p class="peek-note">{(r() as { error: string }).error}</p>}>
            {(peeks) => (
              <Show when={peeks().length > 0} fallback={<p class="peek-note">No definition found for this.</p>}>
                <For each={peeks()}>
                  {(p) => (
                    <div class="peek-one">
                      <p class="peek-file">
                        {p.file}:{p.line}
                        <Show when={WHERE[p.where]}>{(w) => <span class="peek-where"> · {w()}</span>}</Show>
                      </p>
                      <Show when={p.code}>
                        {(code) => (
                          <pre class="peek-code">
                            <For each={highlightCode(code(), p.file)}>
                              {(line, i) => (
                                <div>
                                  <span class="peek-n">{p.line + i()}</span>
                                  <CodeLine spans={line} />
                                </div>
                              )}
                            </For>
                            <Show when={p.more > 0}>
                              <div class="peek-more">… {p.more} more lines</div>
                            </Show>
                          </pre>
                        )}
                      </Show>
                    </div>
                  )}
                </For>
              </Show>
            )}
          </Show>
        )}
      </Show>
    </div>
  );
}
