import { createSignal, For, Match, Show, Switch } from "solid-js";
import { highlightCode } from "../highlight";
import { type Block, type Inline, parseMarkdown } from "../markdown";
import { CodeLine } from "./Code";

function Inlines(props: { of: ReadonlyArray<Inline> }) {
  return (
    <For each={props.of}>
      {(n) => (
        <Switch>
          <Match when={n.kind === "text" && n}>{(t) => <>{t().text}</>}</Match>
          <Match when={n.kind === "strong" && n}>{(t) => <strong><Inlines of={t().children} /></strong>}</Match>
          <Match when={n.kind === "em" && n}>{(t) => <em><Inlines of={t().children} /></em>}</Match>
          <Match when={n.kind === "del" && n}>{(t) => <del><Inlines of={t().children} /></del>}</Match>
          <Match when={n.kind === "code" && n}>{(t) => <code>{t().text}</code>}</Match>
          <Match when={n.kind === "link" && n}>
            {(t) => (
              <a href={t().href} target="_blank" rel="noreferrer noopener">
                <Inlines of={t().children} />
              </a>
            )}
          </Match>
          <Match when={n.kind === "image" && n}>{(i) => <Picture src={i().src} alt={i().alt} />}</Match>
          <Match when={n.kind === "br"}>
            <br />
          </Match>
        </Switch>
      )}
    </For>
  );
}

/** A comment's image, shown; a click opens it whole. One the browser cannot
 *  load (a private repository's, read while signed out of the host) falls
 *  back to a link to it, under its words. */
function Picture(props: { src: string; alt: string }) {
  const [broken, setBroken] = createSignal(false);
  return (
    <a href={props.src} target="_blank" rel="noreferrer noopener">
      <Show when={!broken()} fallback={props.alt || "image"}>
        <img class="md-img" src={props.src} alt={props.alt} loading="lazy" referrerpolicy="no-referrer" onError={() => setBroken(true)} />
      </Show>
    </a>
  );
}

function Blocks(props: { of: ReadonlyArray<Block> }) {
  return (
    <For each={props.of}>
      {(b) => (
        <Switch>
          <Match when={b.kind === "p" && b}>{(p) => <p><Inlines of={p().children} /></p>}</Match>
          <Match when={b.kind === "heading" && b}>
            {(h) => (
              <p class={`md-h md-h${Math.min(h().depth, 3)}`}>
                <Inlines of={h().children} />
              </p>
            )}
          </Match>
          <Match when={b.kind === "code" && b}>
            {(c) => (
              <pre class="md-code">
                <For each={highlightCode(c().text, c().lang || "plaintext")}>
                  {(spans, i) => (
                    <>
                      <Show when={i() > 0}>{"\n"}</Show>
                      <CodeLine spans={spans} />
                    </>
                  )}
                </For>
              </pre>
            )}
          </Match>
          <Match when={b.kind === "quote" && b}>{(q) => <blockquote><Blocks of={q().blocks} /></blockquote>}</Match>
          <Match when={b.kind === "list" && b}>
            {(l) => (
              <Show
                when={l().start !== undefined}
                fallback={
                  <ul>
                    <Items of={l().items} />
                  </ul>
                }
              >
                <ol start={l().start}>
                  <Items of={l().items} />
                </ol>
              </Show>
            )}
          </Match>
          <Match when={b.kind === "table" && b}>
            {(t) => (
              <div class="md-table">
                <table>
                  <thead>
                    <tr>
                      <For each={t().head}>{(c) => <th><Inlines of={c} /></th>}</For>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={t().rows}>{(r) => <tr><For each={r}>{(c) => <td><Inlines of={c} /></td>}</For></tr>}</For>
                  </tbody>
                </table>
              </div>
            )}
          </Match>
          <Match when={b.kind === "hr"}>
            <hr />
          </Match>
        </Switch>
      )}
    </For>
  );
}

function Items(props: { of: ReadonlyArray<{ readonly checked?: boolean; readonly blocks: ReadonlyArray<Block> }> }) {
  return (
    <For each={props.of}>
      {(i) => (
        <li class={i.checked !== undefined ? "md-task" : undefined}>
          <Show when={i.checked !== undefined}>
            <input type="checkbox" checked={i.checked} disabled aria-label={i.checked ? "done" : "not done"} />
          </Show>
          <Blocks of={i.blocks} />
        </li>
      )}
    </For>
  );
}

/** A comment's words as GitHub shows them: formatting as formatting, emoji
 *  shortcodes as emoji, code coloured. Elements of the page's own, never HTML. */
export function Markdown(props: { text: string }) {
  return (
    <div class="md">
      <Blocks of={parseMarkdown(props.text)} />
    </div>
  );
}
