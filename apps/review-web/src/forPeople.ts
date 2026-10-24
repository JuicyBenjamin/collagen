import { bodyParts, suggestionBlock } from "./suggest";

// A comment is read by a person first. An AI drafting one tends to write it
// for another AI: a priority code, a title, then a paragraph dense with
// identifiers and the rules it checked. What a person reads — beside the
// code and on the host — is the short version, in plain words; the AI's
// long one is kept beside it (`detail`), opened on purpose by a person and
// read in full by an agent.

/** A priority code an AI puts in front of a remark: "[P2] …". */
const CODE = /^\s*(\*\*)?\[P\d\]\s*/i;

/** A comment's words for people, and the AI's long version when it wrote
 *  one in its own shape: a coded title over more. Its title, without the
 *  code, is what a person reads — with any suggested change from the rest,
 *  which they can take as it is; the whole stays as the detail. */
export const forPeople = (body: string): { readonly body: string; readonly detail?: string } => {
  const words = body.trim();
  const code = words.match(CODE);
  if (!code) return { body: words };
  const [first = "", ...rest] = words.split("\n");
  const coded = first.replace(CODE, "").trim();
  // a bold title loses its closing marks with its opening ones
  const title = code[1] ? coded.replace(/\*\*$/, "").trim() : coded;
  if (rest.join("\n").trim().length === 0) return { body: title };
  const suggestions = bodyParts(rest.join("\n")).flatMap((part) => (part.kind === "suggestion" ? [suggestionBlock(part.code.length > 0 ? part.code.split("\n") : [])] : []));
  return { body: [title, ...suggestions].join("\n\n"), detail: words };
};

/** What a comment shows a person, and what is one step away: the detail it
 *  carries, or — one written before comments had one — its words read for people. */
export const wordsOf = (comment: { readonly body: string; readonly detail?: string }): { readonly body: string; readonly detail?: string } =>
  comment.detail !== undefined ? { body: comment.body, detail: comment.detail } : forPeople(comment.body);
