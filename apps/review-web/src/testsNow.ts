import { createSignal } from "solid-js";
import type { TestFile } from "./data";
import { testMarksStore } from "./testMarks";
import { ticketId } from "./ticket";

// The review's tests, read apart from its code: which of the two the page
// shows, and the reader's call on each test. Shared by the outline and the
// diff, which both follow the tab.

/** This page's calls on its tests. */
export const testMarks = testMarksStore(ticketId);

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

/** The code or the tests: the page opens on the code, or where its url says. */
const [tabNow, setTab] = createSignal<"code" | "tests">(location.hash.startsWith("#tests") ? "tests" : "code");
export const tab = tabNow;
export const showTab = (shown: "code" | "tests") => {
  setTab(shown);
  history.replaceState(null, "", shown === "tests" ? "#tests" : location.pathname + location.search);
  window.scrollTo({ top: 0 });
};
