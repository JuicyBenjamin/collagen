import { textOf, type TranscriptLine } from "../../../lib/transcripts";

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
