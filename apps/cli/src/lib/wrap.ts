/** Word-wrap text to a width: paragraphs kept, long words cut. Pure. */
export function wrap(text: string, width: number): Array<string> {
  const out: Array<string> = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter((w) => w.length > 0)) {
      const w = word.length > width ? word.slice(0, width) : word;
      if (line.length === 0) line = w;
      else if (line.length + 1 + w.length <= width) line += ` ${w}`;
      else {
        out.push(line);
        line = w;
      }
    }
    out.push(line);
  }
  return out;
}
