import { createSignal, For, Show } from "solid-js";
import type { Hunk as HunkData, TranslationSet } from "~/data";
import { Appear } from "~/components/Appear";
import { Lines } from "~/components/Page/components/Diff/components/Hunk";

// The translations tab: each set of translation files — the same file in
// each language — as the keys its change moves, every language side by
// side, so the reader sees what was added, changed or removed, and which
// language did not keep up. Its lines are one click away.

export function Translations(props: { sets: ReadonlyArray<TranslationSet>; hunks: ReadonlyMap<string, HunkData> }) {
  return <For each={props.sets}>{(set) => <Set set={set} hunks={props.hunks} />}</For>;
}

/** One language's text for a key: as it is now, what it was when it changed, or that it is missing. */
function Text(props: { text: { readonly before?: string; readonly after?: string } | undefined }) {
  const text = () => props.text ?? {};
  return (
    <Show when={text().after !== undefined} fallback={<span class={["badge badge-soft badge-sm", text().before !== undefined ? "badge-error" : "badge-warning"]}>{text().before !== undefined ? "removed" : "missing"}</span>}>
      <span>{text().after}</span>
      <Show when={text().before !== undefined && text().before !== text().after}>
        <del class="translation-was">{text().before}</del>
      </Show>
    </Show>
  );
}

function Set(props: { set: TranslationSet; hunks: ReadonlyMap<string, HunkData> }) {
  const lines = () => props.set.hunks.map((id) => props.hunks.get(id)).filter((hunk): hunk is HunkData => hunk !== undefined);
  const [open, setOpen] = createSignal(props.set.keys === null);
  return (
    <section class="tests-file" id={`translations-${props.set.set}`}>
      <h2 class="tests-file-name">
        <code>{props.set.set}</code> · {props.set.languages.join(", ")}
      </h2>
      <Show when={props.set.keys} fallback={<p class="tests-describe">Not read as keys: its changes below.</p>}>
        {(keys) => (
          <table class="table table-sm">
            <thead>
              <tr>
                <th>Key</th>
                <For each={props.set.languages}>{(lang) => <th>{lang}</th>}</For>
              </tr>
            </thead>
            <tbody>
              <For each={keys()}>
                {(change) => (
                  <tr>
                    <td>
                      <code>{change.key}</code>
                    </td>
                    <For each={props.set.languages}>
                      {(lang) => (
                        <td>
                          <Text text={change.texts[lang]} />
                        </td>
                      )}
                    </For>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        )}
      </Show>
      <label class="test-code-toggle">
        <input type="checkbox" class="checkbox checkbox-primary checkbox-xs" checked={open()} onChange={() => setOpen(!open())} />
        Code · {lines().length === 1 ? "1 change" : `${lines().length} changes`}
      </label>
      <Appear when={open()}>
        {() => (
          <div class="hunk-group test-code">
            <For each={lines()}>
              {(hunk) => (
                <div class="code">
                  <Lines hunk={hunk} threads="all" talk />
                </div>
              )}
            </For>
          </div>
        )}
      </Appear>
    </section>
  );
}
