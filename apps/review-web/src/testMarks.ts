import { createSignal } from "solid-js";

// The reader's call on each test: worth keeping, or questioned. By the
// test's file and titles, so a push that rewrites its body keeps the call —
// it was about whether to test that at all. Kept in this browser, per
// review, like Viewed: the reader's own pass, not something anyone else needs.

export type TestMark = "kept" | "questioned";
type Marks = Readonly<Record<string, TestMark>>;

/** Marks as stored: anything else is dropped. */
export const readTestMarks = (raw: unknown): Marks => {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, TestMark> = {};
  for (const [id, mark] of Object.entries(raw as Record<string, unknown>)) if (mark === "kept" || mark === "questioned") out[id] = mark;
  return out;
};

const key = (ticketId: string) => `collagen.tests.${ticketId}`;

export const testMarksStore = (ticketId: string) => {
  const [marks, setMarks] = createSignal<Marks>(
    (() => {
      try {
        const raw = localStorage.getItem(key(ticketId));
        return readTestMarks(raw ? JSON.parse(raw) : {});
      } catch {
        return {};
      }
    })(),
  );
  /** set, or taken back when it is set already */
  const toggle = (id: string, mark: TestMark) => {
    const next: Record<string, TestMark> = { ...marks() };
    if (next[id] === mark) delete next[id];
    else next[id] = mark;
    setMarks(next);
    try {
      localStorage.setItem(key(ticketId), JSON.stringify(next));
    } catch {
      // private window, storage off: the mark lasts the page, not the browser
    }
  };
  return { of: (id: string): TestMark | undefined => marks()[id], toggle };
};
