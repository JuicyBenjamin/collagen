import { createSignal } from "solid-js";

// A Markdown file in the diff reads rendered, as it is meant to be read;
// its raw lines are a click away. Which files the reader turned to raw.

/** Files whose changes read as a document when rendered. */
export const isMarkdown = (file: string) => /\.(md|markdown)$/i.test(file);

const [raw, setRaw] = createSignal<ReadonlySet<string>>(new Set());

export const mdView = {
  raw: (file: string) => raw().has(file),
  toggle: (file: string) => {
    const next = new Set(raw());
    if (next.has(file)) next.delete(file);
    else next.add(file);
    setRaw(next);
  },
};
