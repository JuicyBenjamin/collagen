// An answer from the reader's AI as the chat panel draws it: plain text,
// with code in fenced blocks drawn as code — nothing else of markdown, and
// never as HTML. A fence still open (the answer is still coming) is code up
// to where the answer has got.

export type AnswerPart = { readonly kind: "text"; readonly text: string } | { readonly kind: "code"; readonly text: string; readonly lang: string };

export const answerParts = (answer: string): ReadonlyArray<AnswerPart> => {
  const parts: Array<AnswerPart> = [];
  // a fence opens at a line's start; without a close it runs to the end
  const fence = /(^|\n)```([^\n`]*)\n([\s\S]*?)(?:\n```[ \t]*(?:\n|$)|$)/;
  let rest = answer;
  while (rest.length > 0) {
    const match = fence.exec(rest);
    if (!match) {
      parts.push({ kind: "text", text: rest });
      break;
    }
    if (match.index > 0) parts.push({ kind: "text", text: rest.slice(0, match.index) });
    parts.push({ kind: "code", lang: match[2]!.trim(), text: match[3]! });
    rest = rest.slice(match.index + match[0].length);
  }
  return parts.map((part) => (part.kind === "text" ? { ...part, text: part.text.replace(/^\n+|\n+$/g, "") } : part)).filter((part) => part.kind === "code" || part.text.length > 0);
};

/** Where selected lines are, in a few characters: "src/a.ts:12–18". */
export const selectionLabel = (selection: { readonly file: string; readonly from: { readonly line: number }; readonly to: { readonly line: number } }): string =>
  `${selection.file}:${selection.from.line === selection.to.line ? selection.to.line : `${selection.from.line}–${selection.to.line}`}`;
