import type { LineComment } from "./data";

// One comment, wherever it was said. A comment finished in collagen goes to
// the room and, on someone else's open pull request, to its host too: two
// copies of one comment. The room's copy names the host's (`hostId`) when
// the host said which it was; one that does not — the host's answer lost,
// or written before collagen read it right — is matched by where it sits and
// what it says. Either way the page shows it once: the host's copy, marked
// as the reader's AI's when the room's is.

/** Where a comment sits and what it says. */
interface Said {
  readonly file: string;
  readonly line: number;
  readonly side: "LEFT" | "RIGHT";
  readonly startLine?: number;
  readonly body: string;
}

/** Words as a host keeps them: its line endings and trailing spaces aside. */
const plain = (body: string): string =>
  body
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();

/** Whether two comments are one: on the same lines, saying the same. */
export const sameComment = (one: Said, other: Said): boolean =>
  one.file === other.file && one.side === other.side && one.line === other.line && (one.startLine ?? one.line) === (other.startLine ?? other.line) && plain(one.body) === plain(other.body);

/** A comment said in the room, with the host's id for its copy there, if it has one. */
export type RoomComment = LineComment & { readonly hostId?: string };

/** The pull request's comments, then the room's that are not on it — each once. */
export const onceEach = (onHost: ReadonlyArray<LineComment>, said: ReadonlyArray<RoomComment>): ReadonlyArray<LineComment> => {
  const hostIds = new Set(onHost.map((comment) => comment.id));
  /** each host comment's room copy, by the host's id */
  const copies = new Map<string, RoomComment>();
  // named first, so a match by words never takes a copy that is named
  for (const comment of said) if (comment.hostId !== undefined && hostIds.has(comment.hostId) && !copies.has(comment.hostId)) copies.set(comment.hostId, comment);
  const roomOnly: Array<LineComment> = [];
  for (const comment of said) {
    if (comment.hostId !== undefined && hostIds.has(comment.hostId)) continue;
    // a copy named but gone from the host (deleted there) stands on its own
    const copy = comment.hostId === undefined ? onHost.find((hosted) => !copies.has(hosted.id) && sameComment(hosted, comment)) : undefined;
    if (copy) copies.set(copy.id, comment);
    else roomOnly.push(comment);
  }
  return [...onHost.map((hosted) => (copies.get(hosted.id)?.drafted ? { ...hosted, drafted: true as const } : hosted)), ...roomOnly];
};
