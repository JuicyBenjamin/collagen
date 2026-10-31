import { textOf, type TranscriptLine } from "../../../lib/transcripts";
import type { PastedImage } from "../../Harness";

// A Claude Code session log's lines, as a person reads them in the app.

/** One line of a Claude Code session, readable — or undefined when it is not
 *  one of Claude Code's (another harness reads it). */
export const readLine = (record: Readonly<Record<string, unknown>>, stamp: string | null): TranscriptLine | null | undefined => {
  const type = typeof record.type === "string" ? record.type : "";
  if ((type === "user" || type === "assistant") && record.message && typeof record.message === "object") {
    const message = record.message as { role?: string; content?: unknown };
    return { ts: stamp, who: message.role ?? type, text: textOf(message.content) };
  }
  if (type === "system") return { ts: stamp, who: "system", text: typeof record.content === "string" ? record.content : String(record.subtype ?? "") };
  if (type === "queue-operation") return { ts: stamp, who: `collagen (${String(record.operation ?? "queue")})`, text: typeof record.content === "string" ? record.content : "" };
  return undefined;
};

/** The images a person pasted into a turn: the user message's own image
 *  parts — a tool's result comes back as a user message too, but its images
 *  sit inside its tool_result, so they are not counted. */
export const pastedImages = (record: Readonly<Record<string, unknown>>): ReadonlyArray<PastedImage> => {
  if (record.type !== "user" || !record.message || typeof record.message !== "object") return [];
  const content = (record.message as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((part) => {
    const source = part && typeof part === "object" && (part as { type?: unknown }).type === "image" ? (part as { source?: { type?: unknown; media_type?: unknown; data?: unknown } }).source : undefined;
    return source && source.type === "base64" && typeof source.media_type === "string" && typeof source.data === "string" ? [{ mime: source.media_type, base64: source.data }] : [];
  });
};
