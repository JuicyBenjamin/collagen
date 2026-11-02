import { createSignal, For } from "solid-js";
import type { GeneratedFile, Hunk as HunkData } from "~/data";
import { Appear } from "~/components/Appear";
import { Lines } from "~/components/Page/components/Diff/components/Hunk";

// The generated tab: each file a tool wrote or a test recorded, on one line
// — what made it and how much moved — so the reader asks only whether it
// should have changed. Its lines are one click away.

export function Generated(props: { files: ReadonlyArray<GeneratedFile>; hunks: ReadonlyMap<string, HunkData> }) {
  return (
    <section class="tests-file">
      <ul class="tests-list">
        <For each={props.files}>{(file) => <Row file={file} hunks={props.hunks} />}</For>
      </ul>
    </section>
  );
}

function Row(props: { file: GeneratedFile; hunks: ReadonlyMap<string, HunkData> }) {
  const [open, setOpen] = createSignal(false);
  const lines = () => props.file.hunks.map((id) => props.hunks.get(id)).filter((hunk): hunk is HunkData => hunk !== undefined);
  return (
    <li class="test" id={`generated-${props.file.file}`}>
      <div class="test-row">
        <span class="badge badge-soft badge-sm">{props.file.by}</span>
        <span class="test-title">
          <code>{props.file.file}</code>
        </span>
        <span class="test-side">
          <span class="test-count">
            +{props.file.added} −{props.file.removed}
          </span>
          <label class="test-code-toggle">
            <input type="checkbox" class="checkbox checkbox-primary checkbox-xs" checked={open()} onChange={() => setOpen(!open())} />
            Code
          </label>
        </span>
      </div>
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
    </li>
  );
}
