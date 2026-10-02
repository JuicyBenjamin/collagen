/** A hover's markdown, as blocks: the code fences the type checker sends
 *  (the signature) and the prose around them (the doc comment). Nothing is
 *  set as HTML — fences become coloured lines, prose stays text, `code`
 *  in prose becomes <code>. */
export function blocks(markdown: string): Array<{ readonly code: string; readonly lang: string } | { readonly text: string }> {
  const out: Array<{ code: string; lang: string } | { text: string }> = [];
  // a fence's info string may carry more than the language ("ts import.meta.vitest")
  const re = /```([^\n]*)\n([\s\S]*?)```/g;
  let at = 0;
  for (let m = re.exec(markdown); m; m = re.exec(markdown)) {
    const before = markdown.slice(at, m.index).trim();
    if (before) out.push({ text: before });
    out.push({ code: m[2]!.replace(/\n$/, ""), lang: m[1]!.trim().split(/\s+/)[0] || "typescript" });
    at = m.index + m[0].length;
  }
  const after = markdown.slice(at).trim();
  if (after) out.push({ text: after });
  return out;
}

/** What a hover shows: the signature, then the doc comment's first
 *  paragraph — a library's doc can run to pages of examples, and the
 *  declaration with its whole comment is one click away (peek). */
export function brief(markdown: string): { readonly blocks: ReturnType<typeof blocks>; readonly more: boolean } {
  const all = blocks(markdown);
  const code = all.find((b) => "code" in b);
  const firstText = all.find((b) => "text" in b) as { text: string } | undefined;
  const para = firstText?.text.split(/\n\s*\n/)[0]?.trim();
  const out = [...(code ? [code] : []), ...(para ? [{ text: para }] : [])];
  return { blocks: out, more: all.length > out.length || (firstText !== undefined && para !== firstText.text.trim()) };
}
