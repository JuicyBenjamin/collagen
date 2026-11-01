/** Where selected lines are, by the file's name alone: "a.ts:12–18" — the full path for a title. */
export const selectionShort = (selection: { readonly file: string; readonly from: { readonly line: number }; readonly to: { readonly line: number } }): string =>
  selectionLabel({ ...selection, file: selection.file.slice(selection.file.lastIndexOf("/") + 1) });

/** Where selected lines are, in a few characters: "src/a.ts:12–18". */
export const selectionLabel = (selection: { readonly file: string; readonly from: { readonly line: number }; readonly to: { readonly line: number } }): string =>
  `${selection.file}:${selection.from.line === selection.to.line ? selection.to.line : `${selection.from.line}–${selection.to.line}`}`;
