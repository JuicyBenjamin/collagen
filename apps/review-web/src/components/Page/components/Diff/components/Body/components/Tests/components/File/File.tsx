import { createMemo, createSignal, For, Show } from "solid-js";
import { NO_TITLE, type Decision, type Hunk as HunkData, type TestCase, type TestFile } from "~/data";
import { Appear } from "~/components/Appear";
import { testFileId, type CaseKind } from "~/testsNow";
import { Fork } from "~/components/Page/components/Diff/components/Fork";
import { Lines } from "~/components/Page/components/Diff/components/Hunk";
import { Row } from "./components/Row";

/** A test file: the decisions and forks pointing into it, its tests under
 *  their describes, and what changed outside any test (imports, helpers). */
export function File(props: { file: TestFile; kind: CaseKind; hunks: ReadonlyMap<string, HunkData>; decisions: ReadonlyMap<string, Decision> }) {
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
              <For each={tests}>{(test) => <Row test={test} kind={props.kind} />}</For>
            </ul>
          </div>
        )}
      </For>
      {/* what changed outside any test (imports, setup, helpers): a row like
          the tests', its code a click away the same way */}
      <Show when={other().length > 0}>
        <ul class="tests-list tests-other">
          <li class="test">
            <div class="test-row">
              <span class="test-change">shared</span>
              <span class="test-title">Setup and helpers</span>
              <span class="test-side">
                <span class="test-count">{other().length === 1 ? "1 change" : `${other().length} changes`}</span>
                <label class="test-code-toggle">
                  <input type="checkbox" class="checkbox checkbox-primary checkbox-xs" checked={otherOpen()} onChange={() => setOtherOpen(!otherOpen())} />
                  Code
                </label>
              </span>
            </div>
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
          </li>
        </ul>
      </Show>
    </section>
  );
}
