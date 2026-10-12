import { createMemo, createSignal, For, Show } from "solid-js";
import { NO_TITLE, type Decision, type Hunk as HunkData, type TestCase, type TestFile } from "~/data";
import { Appear } from "~/components/Appear";
import { testFileId } from "~/testsNow";
import { Fork } from "~/components/Page/components/Diff/components/Fork";
import { Lines } from "~/components/Page/components/Diff/components/Hunk";
import { Row } from "./components/Row";

/** A test file: the decisions and forks pointing into it, its tests under
 *  their describes, and what changed outside any test (imports, helpers). */
export function File(props: { file: TestFile; hunks: ReadonlyMap<string, HunkData>; decisions: ReadonlyMap<string, Decision> }) {
  // the file's tests under their describes, in the file's order
  const groups = createMemo(() => {
    const byDescribe = new Map<string, Array<TestCase>>();
    for (const test of props.file.tests) {
      const at = test.under.join(" › ");
      byDescribe.set(at, [...(byDescribe.get(at) ?? []), test]);
    }
    return [...byDescribe];
  });
  const why = () => props.file.decisions.map((id) => props.decisions.get(id)).filter((decision): decision is Decision => decision !== undefined);
  const other = () => props.file.other.map((id) => props.hunks.get(id)).filter((hunk): hunk is HunkData => hunk !== undefined);
  const [otherOpen, setOtherOpen] = createSignal(false);
  return (
    <section class="tests-file" id={testFileId(props.file.file)}>
      <h2 class="tests-file-name">
        <code>{props.file.file}</code>
      </h2>
      <Show when={why().length > 0 || props.file.forks.length > 0}>
        <div class="tests-why">
          <For each={why()}>
            {(decision) => (
              <p>
                <span class={["why-title", { untitled: !decision.title }]}>{decision.title ?? NO_TITLE}</span> — {decision.what}
              </p>
            )}
          </For>
          <For each={props.file.forks}>{(fork) => <Fork fork={fork} />}</For>
        </div>
      </Show>
      <For each={groups()}>
        {([under, tests]) => (
          <div class="tests-group">
            <Show when={under}>
              <p class="tests-describe">{under}</p>
            </Show>
            <ul class="tests-list">
              <For each={tests}>{(test) => <Row test={test} />}</For>
            </ul>
          </div>
        )}
      </For>
      <Show when={other().length > 0}>
        <div class="tests-other">
          <label class="test-code-toggle">
            <input type="checkbox" checked={otherOpen()} onChange={() => setOtherOpen(!otherOpen())} />
            {other().length === 1 ? "1 change outside a test" : `${other().length} changes outside a test`}
          </label>
          <Appear when={otherOpen()}>
            {() => (
              <div class="hunk-group test-code">
                <For each={other()}>
                  {(hunk) => (
                    <div class="code">
                      <Lines hunk={hunk} threads="all" talk />
                    </div>
                  )}
                </For>
              </div>
            )}
          </Appear>
        </div>
      </Show>
    </section>
  );
}
