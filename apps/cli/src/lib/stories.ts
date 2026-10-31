import type { Found, Scan } from "./tests";

// A review's Storybook stories, read apart from its code by their names. A
// story's picture cannot be shared in a review, so the question is the one
// its name answers: does the state it names make sense, and should it be
// here? A name that does not make sense is itself the finding. Pure.

/** A story's name as Storybook shows it: its own `name`, else its export
 *  spelled out (WithLongTitle → With Long Title). */
const spelled = (exported: string): string =>
  exported
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/^./, (first) => first.toUpperCase())
    .trim();

/** The stories in a file's text: each named export (Component Story Format),
 *  from its line to the line before the next export. Not the default export:
 *  that is the file's meta, not a story. */
export const storiesIn: Scan = (lines) => {
  const starts: Array<{ readonly line: number; readonly exported: string | null }> = [];
  lines.forEach((text, index) => {
    const story = /^export\s+(?:const|let|function)\s+([A-Za-z_$][\w$]*)/.exec(text);
    if (story) starts.push({ line: index + 1, exported: story[1]! });
    else if (/^export\s+(default|\{|\*|type|interface)/.test(text)) starts.push({ line: index + 1, exported: null });
  });
  const tests: Array<Found> = [];
  starts.forEach((start, index) => {
    if (start.exported === null) return;
    let end = (starts[index + 1]?.line ?? lines.length + 1) - 1;
    while (end > start.line && lines[end - 1]!.trim() === "") end--;
    const named = lines
      .slice(start.line - 1, end)
      .map((text) => /^\s*name:\s*(["'`])(.+?)\1/.exec(text)?.[2])
      .find((name) => name !== undefined);
    tests.push({ under: [], title: named ?? spelled(start.exported), start: start.line, end });
  });
  return { tests, groups: [] };
};
