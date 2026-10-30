import { For, Show } from "solid-js";

/** What an answer rests on: a link when it is one, a place in the code as it is written. */
export function Sources(props: { sources: ReadonlyArray<string> }) {
  const link = (source: string) => (/^https?:\/\//.test(source) ? source : /^[\w-]+(\.[\w-]+)+\//.test(source) ? `https://${source}` : null);
  return (
    <Show when={props.sources.length > 0}>
      <p class="inv-sources">
        <span>Sources</span>
        <For each={props.sources}>
          {(source) => (
            <Show when={link(source)} fallback={<code>{source}</code>}>
              {(href) => (
                <a class="link link-hover" href={href()} target="_blank" rel="noreferrer">
                  {source.replace(/^https?:\/\//, "")}
                </a>
              )}
            </Show>
          )}
        </For>
      </p>
    </Show>
  );
}
