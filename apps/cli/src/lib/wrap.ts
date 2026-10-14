/** Word-wrap text to a width: paragraphs kept, long words cut. Pure. */
export function wrap(text: string, width: number): Array<string> {
  const out: Array<string> = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter((part) => part.length > 0)) {
      const piece = word.length > width ? word.slice(0, width) : word;
      if (line.length === 0) line = piece;
      else if (line.length + 1 + piece.length <= width) line += ` ${piece}`;
      else {
        out.push(line);
        line = piece;
      }
    }
    out.push(line);
  }
  return out;
}
