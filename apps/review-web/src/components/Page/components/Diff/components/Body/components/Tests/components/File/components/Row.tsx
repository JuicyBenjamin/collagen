import { createSignal } from "solid-js";
import type { DiffLine, TestCase } from "~/data";
import { Appear } from "~/components/Appear";
import { diffNow } from "~/diffNow";
import { testMarks } from "~/testsNow";
import { Lines } from "~/components/Page/components/Diff/components/Hunk";

const CHANGE: Record<TestCase["change"], string> = { added: "new", changed: "changed", removed: "removed" };

/** A line of the review's diff: a comment on it reaches the pull request.
 *  A test's code also carries the unchanged lines between its changes, which are not. */
const inDiff = (file: string) => {
  const diff = diffNow.hunksOf(file).flatMap((hunk) => hunk.lines);
  return (line: DiffLine): boolean => diff.some((other) => other.kind === line.kind && other.old === line.old && other.new === line.new);
};

/** A test by its title: new, changed or removed, the reader's call on it,
 *  and its code a click away. */
export function Row(props: { test: TestCase }) {
  const [open, setOpen] = createSignal(false);
  const mark = () => testMarks.of(props.test.id);
  return (
    <li class={["test", props.test.change, mark()]}>
      <div class="test-row">
        <span class={["test-change", props.test.change]}>{CHANGE[props.test.change]}</span>
        <span class="test-title">{props.test.title}</span>
        <span class="test-side">
          <button type="button" class={["test-mark", "keep", { on: mark() === "kept" }]} aria-pressed={mark() === "kept" ? "true" : "false"} onClick={() => testMarks.toggle(props.test.id, "kept")}>
            Worth testing
          </button>
          <button type="button" class={["test-mark", "question", { on: mark() === "questioned" }]} aria-pressed={mark() === "questioned" ? "true" : "false"} onClick={() => testMarks.toggle(props.test.id, "questioned")}>
            Question
          </button>
          <label class="test-code-toggle">
            <input type="checkbox" checked={open()} onChange={() => setOpen(!open())} />
            Code
          </label>
        </span>
      </div>
      <Appear when={open()}>
        {() => (
          <div class="hunk-group test-code">
            <div class="code">
              <Lines hunk={props.test.code} threads="all" talk talkOn={inDiff(props.test.file)} />
            </div>
          </div>
        )}
      </Appear>
    </li>
  );
}
