import { createMemo, createSignal, For, Show } from "solid-js";
import type { WholeFileResult } from "~/data";
import { diffNow } from "~/diffNow";
import { parseDocument } from "~/markdown";
import { Markdown } from "~/components/Markdown";

/** A Markdown file as the branch has it, rendered, each block this diff
 *  changed marked beside it. Lines taken out leave a mark on the block
 *  after them; the raw view shows what they said. */
export function Rendered(props: { file: string; read: () => Promise<WholeFileResult> }) {
  const [read, setRead] = createSignal<WholeFileResult | null>(null);
  void props.read().then(setRead);
  const sections = createMemo(() => {
    const result = read();
    return result && "lines" in result ? parseDocument(result.lines.join("\n")) : [];
  });
  const changed = (from: number, to: number) => {
    const added = diffNow.addedIn(props.file);
    const removed = diffNow.removedIn(props.file);
    for (let line = from; line <= to; line++) if (added.has(line) || removed.has(line)) return true;
    return false;
  };
  const failed = () => {
    const result = read();
    return result && "error" in result ? result.error : null;
  };
  return (
    <Show when={read()} fallback={<p class="md-reading">Reading the file…</p>}>
      <Show when={failed()} fallback={
        <div class="md md-document">
          <For each={sections()}>
            {(section) => (
              <div class={{ "md-section": true, changed: changed(section.from, section.to) }} title={changed(section.from, section.to) ? "Changed in this diff" : undefined}>
                <Markdown.Blocks of={section.blocks} />
              </div>
            )}
          </For>
        </div>
      }>
        {(why) => <p class="whole-failed">Could not read the file: {why()}</p>}
      </Show>
    </Show>
  );
}
