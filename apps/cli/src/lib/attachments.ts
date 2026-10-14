import { readFileSync, statSync } from "node:fs";
import { basename, extname } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import type { AttachItem, TranscriptInfo } from "@collagen/p2p";

/** A file is handed over in one ephemeral frame; refuse anything bigger. */
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

/** Bytes over the wire: gzipped, base64. */
export const packBytes = (bytes: Uint8Array): string => gzipSync(bytes).toString("base64");
export const unpackBytes = (data: string): Buffer => gunzipSync(Buffer.from(data, "base64"));

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".log": "text/plain",
  ".csv": "text/csv",
  ".json": "application/json",
  ".jsonl": "application/jsonl",
  ".html": "text/html",
  ".ts": "text/typescript",
  ".js": "text/javascript",
  ".zip": "application/zip",
};

/** A type from the extension — enough for an agent to know whether to look
 *  at it as an image, read it as text, or leave it alone. */
export const mimeOf = (name: string): string => MIME[extname(name).toLowerCase()] ?? "application/octet-stream";

/** A transcript's meta file (`<file>.meta.json`), when the file is one. */
const transcriptInfo = (path: string): TranscriptInfo | undefined => {
  try {
    const meta = JSON.parse(readFileSync(`${path}.meta.json`, "utf8")) as Record<string, unknown>;
    if (typeof meta.from !== "string" || typeof meta.ai !== "string" || typeof meta.threadId !== "string") return undefined;
    return {
      from: meta.from,
      ai: meta.ai,
      threadId: meta.threadId,
      sessionId: typeof meta.sessionId === "string" ? meta.sessionId : "",
      entries: typeof meta.entries === "number" ? meta.entries : 0,
      since: typeof meta.since === "number" ? meta.since : 0,
      origin: typeof meta.origin === "string" ? meta.origin : typeof meta.subject === "string" ? meta.subject : "",
    };
  } catch {
    return undefined;
  }
};

/** Look at a file the person picked: name, size, type — and, when a meta
 *  file sits beside it, what transcript it is. Null when it is not a file. */
export const describeFile = (path: string): AttachItem | null => {
  let bytes: number;
  try {
    const stats = statSync(path);
    if (!stats.isFile()) return null;
    bytes = stats.size;
  } catch {
    return null;
  }
  const name = basename(path);
  const transcript = transcriptInfo(path);
  return { file: path, name, bytes, mime: mimeOf(name), ...(transcript ? { transcript } : {}) };
};

/** Where a fetched attachment is filed: a name safe for any filesystem,
 *  prefixed by the attachment's id so two "shot.png" never collide. */
export const safeName = (name: string): string => name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 100);
