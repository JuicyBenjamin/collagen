// A review's translation files, read apart from its code. What a reviewer
// asks of them is which keys were added, changed or removed, and whether
// every language kept up — so the same file in each language is read
// together, as keys side by side, with its lines a click away. Pure:
// services/ReviewView reads the texts.

/** A translation file: one in a locale folder, or of a format only translations use. */
export const isTranslation = (file: string): boolean =>
  /\.(po|arb|strings|xliff|xlf)$/.test(file) || (/(^|\/)(locales?|i18n|lang|translations|messages)\//.test(file) && /\.(json|ya?ml|properties)$/.test(file));

/** A language tag as files name them: "en", "de", "pt-BR", "zh_Hant". */
const LANG = /^[a-z]{2,3}(?:[-_](?:[A-Z]{2}|[A-Z][a-z]{3}))?$/;

/** A translation file's language, and the set it belongs to: the same path with its language left out. */
export const languageOf = (file: string): { readonly lang: string; readonly set: string } => {
  const parts = file.split("/");
  const base = parts.at(-1)!;
  const stem = base.replace(/\.[^.]+$/, "");
  const ext = base.slice(stem.length);
  // en.json, messages.de.json, strings_fr.arb
  const named = /(?:^|[._-])([a-z]{2,3}(?:[-_](?:[A-Z]{2}|[A-Z][a-z]{3}))?)$/.exec(stem);
  if (named && LANG.test(named[1]!)) return { lang: named[1]!, set: [...parts.slice(0, -1), `${stem.slice(0, stem.length - named[1]!.length)}*${ext}`].join("/") };
  // de/common.json, en.lproj/Localizable.strings
  for (let index = parts.length - 2; index >= 0; index--) {
    const folder = parts[index]!.replace(/\.lproj$/, "");
    if (LANG.test(folder)) return { lang: folder, set: [...parts.slice(0, index), "*", ...parts.slice(index + 1)].join("/") };
  }
  return { lang: stem, set: file };
};

/** Every key and its text, as a translation file's text has them; null when it cannot be read. */
export const keysOf = (file: string, text: ReadonlyArray<string>): ReadonlyMap<string, string> | null => {
  const found = new Map<string, string>();
  if (/\.(json|arb)$/.test(file)) {
    try {
      const flatten = (value: unknown, at: string) => {
        if (value !== null && typeof value === "object" && !Array.isArray(value)) {
          for (const [key, inner] of Object.entries(value)) if (!key.startsWith("@")) flatten(inner, at ? `${at}.${key}` : key);
        } else found.set(at, typeof value === "string" ? value : JSON.stringify(value));
      };
      flatten(JSON.parse(text.join("\n")), "");
    } catch {
      return null;
    }
    return found;
  }
  if (/\.ya?ml$/.test(file)) {
    // a mapping of mappings, nested by indent: what translation files are
    const path: Array<{ readonly indent: number; readonly key: string }> = [];
    for (const line of text) {
      const entry = /^(\s*)(["']?)([^"':#][^"':]*)\2:\s*(.*)$/.exec(line);
      if (!entry || line.trim().startsWith("#")) continue;
      const indent = entry[1]!.length;
      while (path.length > 0 && path.at(-1)!.indent >= indent) path.pop();
      const value = entry[4]!.trim();
      if (value === "" || value === "|" || value === ">") path.push({ indent, key: entry[3]!.trim() });
      else found.set([...path.map((part) => part.key), entry[3]!.trim()].join("."), value.replace(/^(["'])(.*)\1$/, "$2"));
    }
    // a Rails file nests every key under its language: leave that level off
    const keys = [...found.keys()];
    const first = keys[0]?.split(".")[0];
    if (first && LANG.test(first) && keys.every((key) => key.startsWith(`${first}.`))) return new Map([...found].map(([key, value]) => [key.slice(first.length + 1), value]));
    return found;
  }
  if (file.endsWith(".po")) {
    let id: string | null = null;
    for (const line of text) {
      const msgid = /^msgid "(.*)"$/.exec(line);
      if (msgid) id = msgid[1]!;
      const msgstr = /^msgstr "(.*)"$/.exec(line);
      if (msgstr && id) {
        found.set(id, msgstr[1]!);
        id = null;
      }
    }
    return found;
  }
  if (file.endsWith(".properties")) {
    for (const line of text) {
      const entry = /^\s*([^#!=:\s][^=:]*?)\s*[=:]\s*(.*)$/.exec(line);
      if (entry) found.set(entry[1]!, entry[2]!);
    }
    return found;
  }
  if (file.endsWith(".strings")) {
    for (const line of text) {
      const entry = /^\s*"((?:[^"\\]|\\.)*)"\s*=\s*"((?:[^"\\]|\\.)*)";/.exec(line);
      if (entry) found.set(entry[1]!, entry[2]!);
    }
    return found;
  }
  return null;
};

/** One key of a set of translation files, as the change moves it in each language. */
export interface KeyChange {
  readonly key: string;
  /** per language: its text before and after, absent where it is not there */
  readonly texts: Readonly<Record<string, { readonly before?: string; readonly after?: string }>>;
}

/** The keys a change moves in one set of translation files, across its
 *  languages: added, changed or removed in any of them; null when a file of
 *  it cannot be read. `files` maps each language to its file's text at both ends. */
export const keyChanges = (files: ReadonlyArray<{ readonly file: string; readonly lang: string; readonly after: ReadonlyArray<string> | null; readonly before: ReadonlyArray<string> | null }>): ReadonlyArray<KeyChange> | null => {
  const read = files.map((one) => ({ ...one, now: one.after === null ? new Map<string, string>() : keysOf(one.file, one.after), was: one.before === null ? new Map<string, string>() : keysOf(one.file, one.before) }));
  if (read.some((one) => one.now === null || one.was === null)) return null;
  const moved = new Set(read.flatMap((one) => [...new Set([...one.now!.keys(), ...one.was!.keys()])].filter((key) => one.now!.get(key) !== one.was!.get(key))));
  return [...moved].sort().map((key) => ({
    key,
    texts: Object.fromEntries(
      read.map((one) => {
        const before = one.was!.get(key);
        const after = one.now!.get(key);
        return [one.lang, { ...(before !== undefined ? { before } : {}), ...(after !== undefined ? { after } : {}) }];
      }),
    ),
  }));
};
