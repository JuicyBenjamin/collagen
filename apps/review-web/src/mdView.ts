import { createSignal } from "solid-js";

// A Markdown file in the diff reads rendered, as it is meant to be read: its
// changed blocks, added and removed, as code shows its changes. The whole
// file rendered, and its raw lines, are a click away. Which files the reader
// turned to raw, and which they read whole.

/** Files whose changes read as a document when rendered. */
export const isMarkdown = (file: string) => /\.(md|markdown)$/i.test(file);

const flipped = (files: ReadonlySet<string>, file: string): ReadonlySet<string> => {
  const next = new Set(files);
  if (next.has(file)) next.delete(file);
  else next.add(file);
  return next;
};

const [raw, setRaw] = createSignal<ReadonlySet<string>>(new Set());
const [whole, setWhole] = createSignal<ReadonlySet<string>>(new Set());

export const mdView = {
  raw: (file: string) => raw().has(file),
  toggle: (file: string) => setRaw(flipped(raw(), file)),
  /** rendered whole, not just its changed blocks */
  whole: (file: string) => whole().has(file),
  toggleWhole: (file: string) => setWhole(flipped(whole(), file)),
};
