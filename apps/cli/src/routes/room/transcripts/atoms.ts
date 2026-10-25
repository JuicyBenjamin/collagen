import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { Effect } from "effect";
import { readLine, type TranscriptLine } from "../../../lib/transcripts";
import { Harnesses } from "../../../services/Harness";
import { Transcripts, type TranscriptMeta } from "../../../services/Transcripts";
import { runtimeAtom } from "../../../app/runtime";

export interface TranscriptFile {
  readonly subject: string;
  readonly path: string;
  readonly name: string;
  readonly kilobytes: number;
  /** Who, which agent, how much, when — from the sidecar; null for a file without one. */
  readonly meta: TranscriptMeta | null;
}

/** Collected transcripts on disk, newest subject first; "" = every subject. */
export const transcriptFilesAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* ({ subject }: { subject: string }) {
    const transcripts = yield* Transcripts;
    const files = yield* transcripts.list;
    return files
      .filter((file) => subject === "" || file.subject === subject)
      .map((file): TranscriptFile => ({ subject: file.subject, path: file.file, name: basename(file.file), kilobytes: Math.max(1, Math.round(file.bytes / 1024)), meta: file.meta }));
  }),
);

/** One transcript, read and made readable — one row per line worth showing. */
export const transcriptLinesAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* ({ path }: { path: string }) {
    const harnesses = yield* Harnesses;
    const text = yield* Effect.sync(() => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return "";
      }
    });
    return text
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .flatMap((raw) => {
        const line = readLine(harnesses, raw);
        return line ? [{ ...line, raw }] : [];
      });
  }),
);
