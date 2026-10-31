import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Harness } from "../services/Harness";
import { lines } from "./tokenCost";

// The screenshots a person pasted into a conversation with their AI: in the
// harness's own log, as data, never as files their AI could attach. Collagen
// reads them from there and keeps each as a file, so a ticket can carry it.

const EXTENSION: Readonly<Record<string, string>> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

/** The last `count` images pasted into a conversation's log, oldest first,
 *  each saved once under `dir` (named by its content) and given as its path. */
export const pastedImages = (harness: Pick<Harness, "pastedImages">, transcript: string, count: number, dir: string): ReadonlyArray<string> => {
  const found = [...lines(readFileSync(transcript, "utf8"))].flatMap((record) => harness.pastedImages(record));
  if (found.length === 0 || count <= 0) return [];
  mkdirSync(dir, { recursive: true });
  return found.slice(-count).map((image) => {
    const bytes = Buffer.from(image.base64, "base64");
    const path = join(dir, `${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.${EXTENSION[image.mime] ?? "png"}`);
    if (!existsSync(path)) writeFileSync(path, bytes);
    return path;
  });
};
