import { createSignal, For, Show } from "solid-js";
import { readSoFar, stillReading, type DefinitionResult, type Peek as PeekData } from "../data";
import { highlightCode, languageOf } from "../highlight";
import { closePeek, retryPeek } from "../intel";
import { CodeLine } from "./Code";

/** Code longer than this opens folded, the rest one click away. */
const FOLD = 18;

/** A doc comment's first paragraph, without its @tags — the rest is there
 *  when asked for. */
const summary = (doc: string): string => doc.split(/\n\s*\n|\n@/)[0]!.replace(/\s*\n\s*/g, " ").trim();

function Declaration(props: { peek: PeekData }) {
  const [docOpen, setDocOpen] = createSignal(false);
  const [allLines, setAllLines] = createSignal(false);
  const lines = () => (props.peek.code ? highlightCode(props.peek.code, languageOf(props.peek.file)) : []);
  const shown = () => (allLines() ? lines() : lines().slice(0, FOLD));
  const hidden = () => lines().length - shown().length;
  return (
    <div class="peek-one">
      <p class="peek-file">
        {props.peek.file}:{props.peek.line}
        <Show when={props.peek.where === "builtin" && props.peek.builtInto}>
          {(lang) => <span class="peek-where"> · built into {lang()}</span>}
        </Show>
      </p>
      <Show when={props.peek.doc}>
        {(doc) => (
          <div class="peek-doc">
            <Show when={docOpen()} fallback={<p>{summary(doc())}</p>}>
              <p class="peek-doc-full">{doc()}</p>
            </Show>
            <Show when={summary(doc()) !== doc().replace(/\s*\n\s*/g, " ").trim()}>
              <button type="button" class="peek-toggle" onClick={() => setDocOpen(!docOpen())}>
                {docOpen() ? "Less" : "More"}
              </button>
            </Show>
          </div>
        )}
      </Show>
      <Show when={props.peek.code}>
        <pre class="peek-code">
          <For each={shown()}>
            {(line, i) => (
              <div>
                <span class="peek-n">{props.peek.line + i()}</span>
                <CodeLine spans={line} />
              </div>
            )}
          </For>
        </pre>
        <Show when={hidden() > 0 || props.peek.more > 0}>
          <button type="button" class="peek-toggle" onClick={() => setAllLines(true)} disabled={hidden() === 0}>
            {hidden() > 0 ? `Show all ${lines().length + props.peek.more} lines` : `${props.peek.more} more lines in the file`}
          </button>
        </Show>
      </Show>
    </div>
  );
}

/** Ask again, after a failure. */
const Retry = () => (
  <button type="button" class="peek-toggle" onClick={() => retryPeek()}>
    Try again
  </button>
);

/** "reading the project · 40%" */
const reading = (r: DefinitionResult): string => {
  const at = readSoFar(r);
  return `reading the project${at === null ? "…" : ` · ${at}%`}`;
};

/** Where a symbol is declared, opened under the line it was clicked on: its
 *  file and line, its doc comment as text, and the declaration. A symbol
 *  with several (overloads, a value and its namespace) shows the first, the
 *  rest folded. */
export function Peek(props: { result: DefinitionResult | null }) {
  const [rest, setRest] = createSignal(false);
  const peeks = () => (props.result && "peeks" in props.result ? props.result.peeks : []);
  const others = () => peeks().slice(1);
  const overloads = () => others().every((p) => p.file === peeks()[0]?.file);
  return (
    <div class="peek">
      <button class="peek-close" type="button" aria-label="Close" onClick={() => closePeek()}>
        ×
      </button>
      <Show when={props.result} fallback={<p class="peek-note">Finding the definition…</p>}>
        {(r) => (
          <Show
            when={!("error" in r())}
            fallback={
              <p class="peek-note">
                {(r() as { error: string }).error} <Retry />
              </p>
            }
          >
            {/* an answer from a server still reading may be missing things: said, and asked again by the page */}
            <Show when={stillReading(r()) && peeks().length > 0}>
              <p class="peek-note">May be incomplete — {reading(r())}</p>
            </Show>
            <Show
              when={peeks().length > 0}
              fallback={
                <p class="peek-note">
                  {stillReading(r()) ? `Nothing found yet — ${reading(r())}` : "No definition found."}
                </p>
              }
            >
              <Declaration peek={peeks()[0]!} />
              <Show when={others().length > 0}>
                <Show
                  when={rest()}
                  fallback={
                    <button type="button" class="peek-toggle peek-rest" onClick={() => setRest(true)}>
                      {others().length} more {overloads() ? (others().length === 1 ? "overload" : "overloads") : others().length === 1 ? "definition" : "definitions"}
                    </button>
                  }
                >
                  <For each={others()}>{(p) => <Declaration peek={p} />}</For>
                </Show>
              </Show>
            </Show>
          </Show>
        )}
      </Show>
    </div>
  );
}
