// The pages' themes as data — no page, no browser: which themes there
// are, what a theme of the person's own may hold, and reading one from
// pasted CSS or a daisyUI theme generator link. The page shows them
// (theme.ts); collagen keeps them, so the person's agent can choose and add
// them too (the CLI's set-theme).

export type Scheme = "light" | "dark";
export type Theme = { readonly name: string; readonly label: string; readonly scheme: Scheme | null };

/** Every theme themes.css carries; null scheme follows the system. */
export const THEMES: ReadonlyArray<Theme> = [
  { name: "", label: "Collagen", scheme: null },
  { name: "light", label: "Light", scheme: "light" },
  { name: "cupcake", label: "Cupcake", scheme: "light" },
  { name: "nord", label: "Nord", scheme: "light" },
  { name: "corporate", label: "Corporate", scheme: "light" },
  { name: "lofi", label: "Lo-fi", scheme: "light" },
  { name: "dark", label: "Dark", scheme: "dark" },
  { name: "dim", label: "Dim", scheme: "dark" },
  { name: "night", label: "Night", scheme: "dark" },
  { name: "dracula", label: "Dracula", scheme: "dark" },
  { name: "sunset", label: "Sunset", scheme: "dark" },
];
/** The data-theme the person's own theme on show wears (its rule is written in place). */
export const CUSTOM = "custom";

/** A theme's colours and shapes: daisyUI's variables, by name. */
export type Custom = { readonly scheme: Scheme; readonly vars: Readonly<Record<string, string>> };
/** A theme of the person's own, kept: its name and its variables. */
export type Saved = Custom & { readonly id: string; readonly name: string };
/** The page's theme as collagen keeps it: the one chosen — "" collagen's
 *  own, a daisyUI theme's name, or "custom:<id>" — and the person's own. */
export type PageThemes = { readonly chosen: string; readonly saved: ReadonlyArray<Saved> };

/** The variables a daisyUI theme is made of. */
export const isThemeVar = (name: string): boolean => /^--(color-[a-z0-9-]+|radius-(selector|field|box)|size-(selector|field)|border|depth|noise)$/.test(name);

/** Every variable a daisyUI theme sets: its colours (each with the colour
 *  on it, -content), then its shapes. */
export const THEME_VARS: ReadonlyArray<string> = [
  ...["base-100", "base-200", "base-300", "base-content"],
  ...["primary", "secondary", "accent", "neutral", "info", "success", "warning", "error"].flatMap((colour) => [colour, `${colour}-content`]),
]
  .map((colour) => `--color-${colour}`)
  .concat(["--radius-selector", "--radius-field", "--radius-box", "--size-selector", "--size-field", "--border", "--depth", "--noise"]);

/** A value that may go into a <style>: nothing that could end its rule. */
export const safeValue = (value: string): boolean => value.length > 0 && value.length < 200 && !/[;{}<>]/.test(value);

/** A theme pasted as CSS — daisyUI's theme generator's `@plugin
 *  "daisyui/theme" { … }`, or a `[data-theme] { … }` block: its variables and
 *  its scheme. Null when it holds none. */
export function parseTheme(css: string): Custom | null {
  const vars: Record<string, string> = {};
  let scheme: Scheme | null = null;
  for (const match of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[a-z0-9-]+|color-scheme)\s*:\s*([^;{}]+?)\s*(?:;|}|$)/gim)) {
    const name = match[1]!.toLowerCase();
    const value = match[2]!.replace(/^["']|["']$/g, "").trim();
    if (name === "color-scheme") {
      if (value === "light" || value === "dark") scheme = value;
    } else if (isThemeVar(name) && safeValue(value)) vars[name] = value;
  }
  if (Object.keys(vars).length === 0) return null;
  return { scheme: scheme ?? "light", vars };
}

/** The rule a theme of the person's own is shown with. */
export function customCss(custom: Custom): string {
  const lines = Object.entries(custom.vars)
    .filter(([name, value]) => isThemeVar(name) && safeValue(value))
    .map(([name, value]) => `  ${name}: ${value};`);
  return `[data-theme="${CUSTOM}"] {\n  color-scheme: ${custom.scheme};\n${lines.join("\n")}\n}`;
}

/** A theme of daisyUI's theme generator, as its link carries it (decoded):
 *  its variables and its scheme, whatever else it says. Null when it holds none. */
export function themeFromGenerator(json: unknown): Custom | null {
  if (typeof json !== "object" || json === null) return null;
  const fields = json as Record<string, unknown>;
  const vars: Record<string, string> = {};
  for (const [name, value] of Object.entries(fields)) {
    if (isThemeVar(name) && typeof value === "string" && safeValue(value.trim())) vars[name] = value.trim();
  }
  if (Object.keys(vars).length === 0) return null;
  return { scheme: fields["color-scheme"] === "dark" ? "dark" : "light", vars };
}

/** The theme in a daisyUI theme generator link (…/theme-generator/#theme=…),
 *  still packed (base64url of zlib-deflated JSON) — or null for anything else. */
export const generatorPayload = (text: string): string | null => {
  const match = /theme-generator\/?#(?:[^#]*&)?theme=([A-Za-z0-9_-]+={0,2})/.exec(text.trim());
  return match ? match[1]! : null;
};

/** What an option stands for: one of the person's own, by its id. */
export const savedValue = (id: string): string => `custom:${id}`;
export const savedIdOf = (value: string): string | null => (value.startsWith("custom:") ? value.slice("custom:".length) : null);

/** A theme's own name: one line, short, never empty. */
export const NAME_MAX = 32;
export const nameOf = (given: string, fallback: string): string => given.replace(/\s+/g, " ").trim().slice(0, NAME_MAX) || fallback;

/** One theme of the person's own as given — from the page, the state file,
 *  a peer's build — checked as a pasted one is: anything that could leave
 *  its rule is dropped, and a theme with nothing left is none. */
export function savedOf(entry: unknown): Saved | null {
  const fields = (typeof entry === "object" && entry !== null ? entry : {}) as { id?: unknown; name?: unknown; scheme?: unknown; vars?: unknown };
  if (typeof fields.id !== "string" || !/^[\w-]{1,32}$/.test(fields.id)) return null;
  if (typeof fields.vars !== "object" || fields.vars === null || (fields.scheme !== "light" && fields.scheme !== "dark")) return null;
  const read = parseTheme(customCss({ scheme: fields.scheme, vars: fields.vars as Record<string, string> }));
  return read ? { ...read, id: fields.id, name: nameOf(typeof fields.name === "string" ? fields.name : "", "My theme") } : null;
}

/** The page's themes as given, checked: each of the person's own as
 *  savedOf has it, ids unique, and the choice one that exists — else
 *  collagen's own. */
export function checkedThemes(given: unknown): PageThemes {
  const fields = (typeof given === "object" && given !== null ? given : {}) as { chosen?: unknown; saved?: unknown };
  const seen = new Set<string>();
  const saved = (Array.isArray(fields.saved) ? fields.saved : []).flatMap((entry: unknown) => {
    const theme = savedOf(entry);
    if (!theme || seen.has(theme.id)) return [];
    seen.add(theme.id);
    return [theme];
  });
  const chosen = typeof fields.chosen === "string" ? fields.chosen : "";
  const id = savedIdOf(chosen);
  const exists = id !== null ? saved.some((theme) => theme.id === id) : THEMES.some((theme) => theme.name === chosen);
  return { chosen: exists ? chosen : "", saved };
}
