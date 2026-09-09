import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { Effect } from "effect";
import { readLine, type TranscriptLine } from "../../../lib/transcripts";
import { Transcripts, type TranscriptMeta } from "../../../services/Transcripts";
import { runtimeAtom } from "../../../app/runtime";

export interface TranscriptFile {
  readonly subject: string;
  readonly path: string;
  readonly name: string;
  readonly kb: number;
  /** Who, which agent, how much, when — from the sidecar; null for a file without one. */
  readonly meta: TranscriptMeta | null;
}

/** Collected transcripts on disk, newest subject first; "" = every subject. */
export const transcriptFilesAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* ({ subject }: { subject: string }) {
    const t = yield* Transcripts;
    const files = yield* t.list;
    return files
      .filter((f) => subject === "" || f.subject === subject)
      .map((f): TranscriptFile => ({ subject: f.subject, path: f.file, name: basename(f.file), kb: Math.max(1, Math.round(f.bytes / 1024)), meta: f.meta }));
  }),
);

/** One transcript, read and made readable — one row per line worth showing. */
export const transcriptLinesAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* ({ path }: { path: string }) {
    const text = yield* Effect.sync(() => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return "";
      }
    });
    return text
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .flatMap((raw) => {
        const line = readLine(raw);
        return line ? [{ ...line, raw }] : [];
      });
  }),
);
