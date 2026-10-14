// Suggested changes, as GitHub writes them in a comment: a fenced block
// whose info string is `suggestion`, holding the lines that should replace
// the ones the comment is on. The composer inserts one prefilled with those
// lines; a comment carrying one shows it as a change, with its code to copy.

/** One part of a comment's words: plain text, or a suggested change. */
export type BodyPart = { readonly kind: "text"; readonly text: string } | { readonly kind: "suggestion"; readonly code: string };

/** A suggestion block replacing `lines`, prefilled with them — the reader
 *  edits it into what they mean. A fence longer than any backtick run in the
 *  code, so code with ``` in it cannot close it early. */
export const suggestionBlock = (lines: ReadonlyArray<string>): string => {
  const longest = Math.max(2, ...lines.map((line) => Math.max(0, ...[...line.matchAll(/`+/g)].map((match) => match[0].length))));
  const fence = "`".repeat(longest + 1);
  return `${fence}suggestion\n${lines.join("\n")}\n${fence}`;
};

/** A comment's words split into text and suggested changes, in order. A
 *  fence that never closes is text, as GitHub shows it. */
export const bodyParts = (body: string): ReadonlyArray<BodyPart> => {
  const parts: Array<BodyPart> = [];
  const lines = body.split("\n");
  let text: Array<string> = [];
  const flush = () => {
    const trimmed = text.join("\n").trim();
    if (trimmed.length > 0) parts.push({ kind: "text", text: trimmed });
    text = [];
  };
  for (let index = 0; index < lines.length; index++) {
    const open = lines[index]!.match(/^\s*(`{3,})\s*suggestion\s*$/);
    const close = open ? lines.findIndex((line, lineIndex) => lineIndex > index && line.trim() === open[1]) : -1;
    if (!open || close === -1) {
      text.push(lines[index]!);
      continue;
    }
    flush();
    parts.push({ kind: "suggestion", code: lines.slice(index + 1, close).join("\n") });
    index = close;
  }
  flush();
  return parts;
};
