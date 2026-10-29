import { createSignal, For, Match, Show, Switch } from "solid-js";
import { highlightCode } from "../highlight";
import { type Block, type Inline, parseMarkdown } from "../markdown";
import { CodeLine } from "./Code";

function Inlines(props: { of: ReadonlyArray<Inline> }) {
  return (
    <For each={props.of}>
      {(node) => (
        <Switch>
          <Match when={node.kind === "text" && node}>{(inline) => <>{inline().text}</>}</Match>
          <Match when={node.kind === "strong" && node}>{(inline) => <strong><Inlines of={inline().children} /></strong>}</Match>
          <Match when={node.kind === "em" && node}>{(inline) => <em><Inlines of={inline().children} /></em>}</Match>
          <Match when={node.kind === "del" && node}>{(inline) => <del><Inlines of={inline().children} /></del>}</Match>
          <Match when={node.kind === "code" && node}>{(inline) => <code>{inline().text}</code>}</Match>
          <Match when={node.kind === "link" && node}>
            {(inline) => (
              <a href={inline().href} target="_blank" rel="noreferrer noopener">
                <Inlines of={inline().children} />
              </a>
            )}
          </Match>
          <Match when={node.kind === "image" && node}>{(image) => <Picture src={image().src} alt={image().alt} />}</Match>
          <Match when={node.kind === "br"}>
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
      {(block) => (
        <Switch>
          <Match when={block.kind === "p" && block}>{(paragraph) => <p><Inlines of={paragraph().children} /></p>}</Match>
          <Match when={block.kind === "heading" && block}>
            {(heading) => (
              <p class={`md-h md-h${Math.min(heading().depth, 3)}`}>
                <Inlines of={heading().children} />
              </p>
            )}
          </Match>
          <Match when={block.kind === "code" && block}>
            {(code) => (
              <pre class="md-code">
                <For each={highlightCode(code().text, code().lang)}>
                  {(spans, index) => (
                    <>
                      <Show when={index() > 0}>{"\n"}</Show>
                      <CodeLine spans={spans} />
                    </>
                  )}
                </For>
              </pre>
            )}
          </Match>
          <Match when={block.kind === "quote" && block}>{(quote) => <blockquote><Blocks of={quote().blocks} /></blockquote>}</Match>
          <Match when={block.kind === "list" && block}>
            {(list) => (
              <Show
                when={list().start !== undefined}
                fallback={
                  <ul>
                    <Items of={list().items} />
                  </ul>
                }
              >
                <ol start={list().start}>
                  <Items of={list().items} />
                </ol>
              </Show>
            )}
          </Match>
          <Match when={block.kind === "table" && block}>
            {(table) => (
              <div class="md-table">
                <table>
                  <thead>
                    <tr>
                      <For each={table().head}>{(cell) => <th><Inlines of={cell} /></th>}</For>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={table().rows}>{(row) => <tr><For each={row}>{(cell) => <td><Inlines of={cell} /></td>}</For></tr>}</For>
                  </tbody>
                </table>
              </div>
            )}
          </Match>
          <Match when={block.kind === "hr"}>
            <hr />
          </Match>
          <Match when={block.kind === "fields" && block}>
            {(front) => (
              <dl class="md-fields">
                <For each={front().fields}>
                  {(field) => (
                    <>
                      <dt>{field.name}</dt>
                      <dd>{field.value}</dd>
                    </>
                  )}
                </For>
              </dl>
            )}
          </Match>
        </Switch>
      )}
    </For>
  );
}

function Items(props: { of: ReadonlyArray<{ readonly checked?: boolean; readonly blocks: ReadonlyArray<Block> }> }) {
  return (
    <For each={props.of}>
      {(item) => (
        <li class={item.checked !== undefined ? "md-task" : undefined}>
          <Show when={item.checked !== undefined}>
            <input type="checkbox" checked={item.checked} disabled aria-label={item.checked ? "done" : "not done"} />
          </Show>
          <Blocks of={item.blocks} />
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

/** A Markdown file's blocks, as a document rather than a comment. */
Markdown.Blocks = Blocks;
