import { createSignal } from "solid-js";
import type { TestFile } from "./data";
import { testMarksStore } from "./testMarks";
import { ticketId } from "./ticket";

// The review's tests, read apart from its code: which of the two the page
// shows, and the reader's call on each test. Shared by the outline and the
// diff, which both follow the tab.

/** This page's calls on its tests. */
export const testMarks = testMarksStore(ticketId);

/** What a tab of cases is: tests, judged by what they protect, or stories,
 *  judged by their names — the state each names, and whether it makes sense. */
export type CaseKind = "test" | "story";
export const CASE_WORDS: Record<CaseKind, { readonly title: string; readonly one: string; readonly many: string; readonly keep: string }> = {
  test: { title: "Tests", one: "test", many: "tests", keep: "Worth testing" },
  story: { title: "Stories", one: "story", many: "stories", keep: "Makes sense" },
};

/** Where a test file's section is, for the outline. */
export const testFileId = (file: string) => `tests-${file.replace(/[^\w-]/g, "-")}`;

/** How far the reader is through a review's tests: judged either way, and questioned. */
export const testsJudged = (files: ReadonlyArray<TestFile>) => {
  const all = files.flatMap((file) => file.tests);
  return {
    tests: all.length,
    judged: all.filter((test) => testMarks.of(test.id) !== undefined).length,
    questioned: all.filter((test) => testMarks.of(test.id) === "questioned").length,
  };
};

/** What the page shows under its header: the code, how the change works, its
 *  tests or its stories — the code, unless the url says otherwise. */
type Tab = "code" | "machine" | "tests" | "stories";
const hashes: Record<Tab, string> = { code: "", machine: "#how-it-works", tests: "#tests", stories: "#stories" };
const [tabNow, setTab] = createSignal<Tab>(location.hash.startsWith("#tests") ? "tests" : location.hash.startsWith("#stories") ? "stories" : location.hash.startsWith("#how-it-works") ? "machine" : "code");
export const tab = tabNow;
export const showTab = (shown: Tab) => {
  setTab(shown);
  history.replaceState(null, "", hashes[shown] || location.pathname + location.search);
  window.scrollTo({ top: 0 });
};
