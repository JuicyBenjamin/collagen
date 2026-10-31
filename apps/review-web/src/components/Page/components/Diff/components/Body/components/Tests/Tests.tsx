import { For } from "solid-js";
import type { Decision, Hunk as HunkData, TestFile } from "~/data";
import type { CaseKind } from "~/testsNow";
import { File } from "./components/File";

// The tests tab: a review's tests apart from its code, each led by its title
// — what it claims to protect — under the describes it sits in, so the
// reader judges whether it is worth having at all. How it is written is one
// click away: the whole test as one hunk.

export function Tests(props: { files: ReadonlyArray<TestFile>; kind: CaseKind; hunks: ReadonlyMap<string, HunkData>; decisions: ReadonlyMap<string, Decision> }) {
  return <For each={props.files}>{(file) => <File file={file} kind={props.kind} hunks={props.hunks} decisions={props.decisions} />}</For>;
}
