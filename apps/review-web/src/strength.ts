// How strongly a comment asks for a change, from a nit to a must. Carried in
// the comment's own words as a prefix ("nit: …"), so it goes wherever the
// words go — the room, the host, which has no such thing — and is read back
// from them, whoever wrote it. No prefix: a plain comment. A must asks for
// changes: one in a review makes the whole review ask for them, as the host
// has one verdict per review.

export type Strength = "nit" | "suggest" | "wish" | "must";

/** Weakest first, as the page offers them. */
export const STRENGTHS: ReadonlyArray<{ readonly value: Strength; readonly hint: string }> = [
  { value: "nit", hint: "Take it or leave it" },
  { value: "suggest", hint: "Worth considering" },
  { value: "wish", hint: "I'd like this changed" },
  { value: "must", hint: "Has to change — the review requests changes" },
];

const PREFIX = /^\s*(nit|suggest|wish|must)\s*:[ \t]*\n?/i;

/** A comment's strength, from its prefix, and its words without it. */
export const readStrength = (body: string): { readonly strength: Strength | null; readonly text: string } => {
  const match = body.match(PREFIX);
  return match ? { strength: match[1]!.toLowerCase() as Strength, text: body.slice(match[0].length) } : { strength: null, text: body };
};

/** Words with a strength put in front, replacing any they had; none given, the words as they are. */
export const withStrength = (strength: Strength | null, body: string): string => (strength === null ? body : `${strength}: ${readStrength(body).text}`);

/** Whether a comment asks for changes, so its review does too. */
export const asksForChanges = (body: string): boolean => readStrength(body).strength === "must";
