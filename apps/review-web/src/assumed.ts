import { createSignal } from "solid-js";
import type { Decision, Hunk } from "./data";

// A review built from assumptions: its why is the reader's AI's guesses about
// someone else's change. The reader checks each — it holds, or it goes to the
// author as a question, in the review they finish on the pull request.

/** What the reader has made of a guess: it holds, or it was put to the author. */
export type Check = "holds" | "asked";

/** The question a guess becomes, in the reader's voice — theirs to edit
 *  while it is pending in their review. */
export const questionFor = (d: Decision): string =>
  [`Checking an assumption: "${d.title ?? d.what}" — ${d.what}`, d.agentWhy ? `My reading: ${d.agentWhy}` : "", "Is that the reason?"].filter((x) => x.length > 0).join("\n\n");

/** Where on the diff a guess's question goes: the line its `where` names
 *  when the diff shows it on the new side, else the first line its file's
 *  changes add or keep — or nowhere, when the diff does not change the file. */
export function spotFor(where: ReadonlyArray<string>, hunksOf: (file: string) => ReadonlyArray<Hunk>): { readonly file: string; readonly line: number } | null {
  for (const w of where) {
    const m = /^(.*?)(?::(\d+))?(?:-\d+)?$/.exec(w.trim());
    if (!m) continue;
    const file = m[1]!;
    const lines = hunksOf(file).flatMap((h) => h.lines.filter((l) => l.kind !== "-" && l.new !== undefined).map((l) => ({ n: l.new!, added: l.kind === "+" })));
    if (lines.length === 0) continue;
    const named = m[2] ? Number(m[2]) : undefined;
    if (named !== undefined && lines.some((l) => l.n === named)) return { file, line: named };
    return { file, line: (lines.find((l) => l.added) ?? lines[0]!).n };
  }
  return null;
}

const key = (ticketId: string) => `collagen.assumed.${ticketId}`;

const load = (ticketId: string): Readonly<Record<string, Check>> => {
  try {
    const raw = JSON.parse(localStorage.getItem(key(ticketId)) ?? "{}") as unknown;
    if (!raw || typeof raw !== "object") return {};
    return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter((e): e is [string, Check] => e[1] === "holds" || e[1] === "asked"));
  } catch {
    return {};
  }
};

/** The reader's checks on one review's guesses — theirs, on this browser. */
export const assumedStore = (ticketId: string) => {
  const [checks, setChecks] = createSignal<Readonly<Record<string, Check>>>(load(ticketId));
  const set = (id: string, check: Check | null) => {
    const next = { ...checks() };
    if (check === null) delete next[id];
    else next[id] = check;
    setChecks(next);
    try {
      localStorage.setItem(key(ticketId), JSON.stringify(next));
    } catch {
      // private window, storage off: the check lasts the page
    }
  };
  return { check: (id: string): Check | undefined => checks()[id], set, checked: (ids: ReadonlyArray<string>) => ids.filter((id) => checks()[id] !== undefined).length };
};
