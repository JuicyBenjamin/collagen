import { inflateSync } from "node:zlib";
import type { PageThemes } from "@collagen/p2p";
import { checkedThemes, generatorPayload, nameOf, parseTheme, safeValue, savedIdOf, savedValue, THEME_VARS, THEMES, themeFromGenerator, type Custom, type Saved, type Scheme } from "@collagen/review-web/themeData";

// The review page's themes as the person's agent sees and sets them (themes,
// set-theme, add-theme, edit-theme, remove-theme): by name, a theme read from
// a daisyUI theme generator link or its CSS, a colour by its short name.
// Kept in the person's state, so every open page follows.

export const NO_THEMES: PageThemes = { chosen: "", saved: [] };

/** A theme as given: a daisyUI theme generator link, unpacked, or a theme's CSS. Null for neither. */
export function themeFromText(text: string): Custom | null {
  const payload = generatorPayload(text);
  if (payload === null) return parseTheme(text);
  try {
    return themeFromGenerator(JSON.parse(inflateSync(Buffer.from(payload, "base64url")).toString("utf8")) as unknown);
  } catch {
    return null;
  }
}

const same = (one: string, other: string): boolean => one.trim().toLowerCase() === other.trim().toLowerCase();

/** One of daisyUI's themes (or collagen's own) by its name, any case. */
const listed = (name: string) => THEMES.find((theme) => same(theme.label, name) || (theme.name !== "" && same(theme.name, name)));

/** What a theme's name stands for: collagen's own, one of daisyUI's, or one of the person's own. Null for none. */
export function valueNamed(themes: PageThemes, name: string): string | null {
  const theirs = listed(name);
  if (theirs) return theirs.name;
  const own = themes.saved.find((theme) => same(theme.name, name));
  return own ? savedValue(own.id) : null;
}

/** One of the person's own, by its name, any case. */
export const ownNamed = (themes: PageThemes, name: string): Saved | undefined => themes.saved.find((theme) => same(theme.name, name));

/** Whether a name is free for one of the person's own: not daisyUI's, not
 *  collagen's, not another of theirs (but its own, on a rename). */
export const nameTaken = (themes: PageThemes, name: string, keeping?: Saved): string | null => {
  if (listed(name) !== undefined || same(name, "collagen")) return `"${name}" is one of daisyUI's themes — name your user's own something else`;
  const other = ownNamed(themes, name);
  return other && other.id !== keeping?.id ? `your user already has a theme named "${other.name}"` : null;
};

/** A theme of the person's own added, and chosen when asked. */
export function withTheme(themes: PageThemes, name: string, theme: Custom, id: string, choose: boolean): PageThemes {
  const entry = { ...theme, id, name: nameOf(name, "My theme") };
  return checkedThemes({ chosen: choose ? savedValue(id) : themes.chosen, saved: [...themes.saved, entry] });
}

/** A colour (or shape) by its short name, as an agent says it — "primary",
 *  "base-100", "radius-box", or the variable itself — as daisyUI's variable. Null for none. */
export const themeVarNamed = (given: string): string | null => {
  const bare = given.trim().toLowerCase().replace(/^--/, "");
  for (const name of [`--${bare}`, `--color-${bare}`]) if (THEME_VARS.includes(name)) return name;
  return null;
};

/** What changes in one of the person's own: a new name, a theme taken over it, colours by name, its scheme. */
export interface ThemeEdit {
  readonly rename?: string;
  readonly from?: Custom;
  readonly colours?: Readonly<Record<string, string>>;
  readonly scheme?: Scheme;
}

/** One of the person's own changed in place — or why it cannot be: a colour
 *  that is no theme variable, or a value that could leave its rule. */
export function withEdit(themes: PageThemes, theme: Saved, edit: ThemeEdit): PageThemes | string {
  const vars: Record<string, string> = { ...theme.vars, ...edit.from?.vars };
  for (const [given, value] of Object.entries(edit.colours ?? {})) {
    const name = themeVarNamed(given);
    if (name === null) return `"${given}" is no theme colour — use daisyUI's names: primary, primary-content, secondary, accent, neutral, base-100, base-200, base-300, base-content, info, success, warning, error (each with -content), or radius-box, radius-field, radius-selector, border, depth, noise`;
    if (!safeValue(value.trim())) return `"${value}" cannot be a value for ${given}`;
    vars[name] = value.trim();
  }
  const edited: Saved = { ...theme, name: edit.rename ? nameOf(edit.rename, theme.name) : theme.name, scheme: edit.scheme ?? edit.from?.scheme ?? theme.scheme, vars };
  return checkedThemes({ ...themes, saved: themes.saved.map((current) => (current.id === theme.id ? edited : current)) });
}

/** A theme of the person's own taken away; the page goes back to collagen's own if it was on show. */
export function withoutTheme(themes: PageThemes, name: string): PageThemes | null {
  const gone = themes.saved.find((saved) => same(saved.name, name));
  if (!gone) return null;
  return checkedThemes({ chosen: savedIdOf(themes.chosen) === gone.id ? "" : themes.chosen, saved: themes.saved.filter((saved) => saved.id !== gone.id) });
}

/** The themes there are, and which is on, for the agent to read — each of
 *  the person's own with its colours, to edit by. */
export function describeThemes(themes: PageThemes): string {
  const on = (value: string) => (themes.chosen === value ? " — on" : "");
  const short = (name: string) => name.replace(/^--(color-)?/, "");
  return [
    "Review page themes:",
    ...THEMES.map((theme) => `- ${theme.label}${theme.name === "" ? " (collagen's own)" : ""}${on(theme.name)}`),
    ...(themes.saved.length > 0
      ? [
          "Your user's own:",
          ...themes.saved.map((theme) => `- ${theme.name} (${theme.scheme})${on(savedValue(theme.id))}\n    ${Object.entries(theme.vars).map(([name, value]) => `${short(name)}: ${value}`).join("; ")}`),
        ]
      : ["Your user has none of their own yet."]),
  ].join("\n");
}
