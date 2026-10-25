import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import type { Harness } from "../services/Harness";

/** Every regular file under `dir`, depth-first, or [] when it doesn't exist. */
export function walk(dir: string, depth = 6): Array<string> {
  if (depth < 0) return [];
  let names: Array<string>;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: Array<string> = [];
  for (const name of names) {
    const path = join(dir, name);
    try {
      if (statSync(path).isDirectory()) out.push(...walk(path, depth - 1));
      else out.push(path);
    } catch {
      /* vanished — skip */
    }
  }
  return out;
}

/** The lines of a session file worth handing over: entries stamped at or
 *  after `since` (ms), plus any un-stamped lines and the ones its harness
 *  says give the rest its shape (`keepsWhole`). Unparseable lines are dropped. */
export function sliceSince(jsonl: string, since: number, keepsWhole: (record: Readonly<Record<string, unknown>>) => boolean): { readonly lines: ReadonlyArray<string>; readonly entries: number } {
  const lines: Array<string> = [];
  let entries = 0;
  for (const raw of jsonl.split("\n")) {
    const line = raw.trim();
    if (line.length === 0) continue;
    let parsed: { timestamp?: unknown; type?: unknown };
    try {
      parsed = JSON.parse(line) as typeof parsed;
    } catch {
      continue;
    }
    if (keepsWhole(parsed)) {
      lines.push(line);
      continue;
    }
    const at = typeof parsed.timestamp === "string" ? Date.parse(parsed.timestamp) : typeof parsed.timestamp === "number" ? parsed.timestamp : NaN;
    if (Number.isNaN(at)) {
      lines.push(line); // no stamp: keep, it belongs to whatever surrounds it
      continue;
    }
    if (at >= since) {
      lines.push(line);
      entries++;
    }
  }
  return { lines, entries };
}

/** One session line, readable: when, who, what — for showing a transcript in
 *  the app. Each harness reads its own lines (Harness.readLine); null = noise
 *  not worth a row (token counts, turn context, attachments). */
export interface TranscriptLine {
  readonly ts: string | null;
  readonly who: string;
  readonly text: string;
}

export const textOf = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item: unknown) => {
      if (typeof item === "string") return item;
      if (!item || typeof item !== "object") return "";
      const part = item as { type?: string; text?: string; name?: string; input?: unknown; content?: unknown };
      if (typeof part.text === "string") return part.text;
      if (part.type === "thinking") return "(thinking)";
      if (part.type === "tool_use") return `⚙ ${part.name ?? "tool"} ${JSON.stringify(part.input ?? {}).slice(0, 200)}`;
      if (part.type === "tool_result") return `↳ ${textOf(part.content).slice(0, 200)}`;
      return "";
    })
    .filter((text) => text.length > 0)
    .join("\n");
};

export function readLine(harnesses: ReadonlyArray<Pick<Harness, "readLine">>, raw: string): TranscriptLine | null {
  let record: Record<string, unknown>;
  try {
    record = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const stamp = typeof record.timestamp === "string" ? record.timestamp : null;
  // the harness whose line it is says how it reads; anything else with
  // nothing to say is bookkeeping, not conversation
  for (const harness of harnesses) {
    const line = harness.readLine(record, stamp);
    if (line !== undefined) return line;
  }
  return null;
}

/** Wire form of a slice: gzip + base64 of the JSONL. */
export const pack = (lines: ReadonlyArray<string>): string => gzipSync(Buffer.from(lines.join("\n") + "\n", "utf8")).toString("base64");
export const unpack = (data: string): string => gunzipSync(Buffer.from(data, "base64")).toString("utf8");

/** Refuse to ship more than this over an ephemeral frame (gzipped bytes). */
export const MAX_PACKED_BYTES = 8 * 1024 * 1024;
