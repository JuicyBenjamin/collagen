import { createMemo, createSignal, For, Show } from "solid-js";
import type { WholeFileResult } from "~/data";
import { diffNow } from "~/diffNow";
import { parseDocument } from "~/markdown";
import { changedBlocks } from "~/mdChanges";
import { Markdown } from "~/components/Markdown";

/** A Markdown file this diff changed, rendered: just the blocks it adds and
 *  takes out, each marked as code marks its lines; or, `whole`, the file as
 *  the branch has it, each block this diff changed marked beside it. */
export function Rendered(props: { file: string; whole: boolean; read: () => Promise<WholeFileResult> }) {
  const [read, setRead] = createSignal<WholeFileResult | null>(null);
  void props.read().then(setRead);
  const sections = createMemo(() => {
    const result = read();
    return result && "lines" in result ? parseDocument(result.lines.join("\n")) : [];
  });
  const changes = createMemo(() => {
    const result = read();
    return result && "lines" in result ? changedBlocks(result.lines.join("\n"), diffNow.hunksOf(props.file)) : [];
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
        <Show when={props.whole} fallback={
          <div class="md md-document">
            <For each={changes()}>
              {(change) => (
                <>
                  <Show when={change.gapBefore}>
                    <div class="md-gap" aria-label="Unchanged" />
                  </Show>
                  <div class={{ "md-section": true, changed: change.kind === "added", went: change.kind === "removed" }} title={change.kind === "added" ? "Added" : "Removed"}>
                    <Markdown.Blocks of={change.blocks} />
                  </div>
                </>
              )}
            </For>
          </div>
        }>
          <div class="md md-document">
            <For each={sections()}>
              {(section) => (
                <div class={{ "md-section": true, changed: changed(section.from, section.to) }} title={changed(section.from, section.to) ? "Changed in this diff" : undefined}>
                  <Markdown.Blocks of={section.blocks} />
                </div>
              )}
            </For>
          </div>
        </Show>
      }>
        {(why) => <p class="whole-failed">Could not read the file: {why()}</p>}
      </Show>
    </Show>
  );
}
