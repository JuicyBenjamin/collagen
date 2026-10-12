import { checkedThemes, CUSTOM, customCss, generatorPayload, parseTheme, safeValue, savedIdOf, savedValue, THEME_VARS, THEMES, themeFromGenerator, type Custom, type PageThemes } from "./themeData";

/* The page's theme on show: a daisyUI theme, a data-theme on <html> swapping
   one block of CSS variables for another (themes.css). No theme chosen is
   collagen's own, light or dark as the system is. Collagen keeps the choice
   and the person's own themes (themeData), so their agent can choose and add
   them too; this browser keeps a copy, so a page opens in its theme before
   collagen has answered. */

/** What the select says for a new theme of the person's own. */
export const NEW = "new";

/** The variables the editor shows, with a word for each. */
export const EDITABLE: ReadonlyArray<readonly [string, string]> = [
  ["--color-base-200", "Page"],
  ["--color-base-100", "Panel"],
  ["--color-base-content", "Text"],
  ["--color-primary", "Accent"],
  ["--color-primary-content", "On accent"],
  ["--color-warning", "Warning"],
  ["--color-success", "Added"],
  ["--color-error", "Removed"],
];

const CACHE_KEY = "collagen.theme.v2";
// what an older page kept in the browser alone, before collagen kept themes
const OLD_CHOSEN_KEY = "collagen.theme";
const OLD_SAVED_KEY = "collagen.theme.saved.v1";
const OLD_CUSTOM_KEY = "collagen.theme.custom";

/** The themes this browser has: its copy of collagen's, or — on a first
 *  visit since collagen kept them — what an older page kept here alone: its
 *  named themes, or its one custom theme as "My theme". */
export function themesFromBrowser(cache: string | null, oldChosen: string | null, oldSaved: string | null, oldCustom: string | null): PageThemes {
  const parsed = (raw: string | null): unknown => {
    try {
      return raw === null ? null : (JSON.parse(raw) as unknown);
    } catch {
      return null;
    }
  };
  if (cache !== null) return checkedThemes(parsed(cache));
  const one = parsed(oldCustom);
  const saved = oldSaved !== null ? parsed(oldSaved) : one !== null && typeof one === "object" ? [{ ...one, id: "mine", name: "My theme" }] : [];
  return checkedThemes({ chosen: oldChosen === CUSTOM ? savedValue("mine") : (oldChosen ?? ""), saved });
}

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const cachedThemes = (): PageThemes => themesFromBrowser(read(CACHE_KEY), read(OLD_CHOSEN_KEY), read(OLD_SAVED_KEY), read(OLD_CUSTOM_KEY));

/** Whether this browser held themes of an older page's that collagen has not been given yet. */
export const heldBeforeCollagen = (): boolean => read(CACHE_KEY) === null && (read(OLD_CHOSEN_KEY) !== null || read(OLD_SAVED_KEY) !== null || read(OLD_CUSTOM_KEY) !== null);

export function cacheThemes(themes: PageThemes): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(themes));
    for (const key of [OLD_CHOSEN_KEY, OLD_SAVED_KEY, OLD_CUSTOM_KEY]) localStorage.removeItem(key);
  } catch {
    // a private window: kept for this visit
  }
}

/** Show the chosen theme on the page: its variables, and its scheme for the
 *  code's colours (main.tsx). "" is collagen's own, following the system. */
export function applyTheme(themes: PageThemes): void {
  const root = document.documentElement;
  const id = savedIdOf(themes.chosen);
  const own = id === null ? undefined : themes.saved.find((theme) => theme.id === id);
  customStyle().textContent = own ? customCss(own) : "";
  const scheme = own ? own.scheme : (THEMES.find((theme) => theme.name === themes.chosen)?.scheme ?? null);
  if (own) root.dataset.theme = CUSTOM;
  else if (themes.chosen === "" || id !== null) delete root.dataset.theme;
  else root.dataset.theme = themes.chosen;
  if (scheme) root.dataset.scheme = scheme;
  else delete root.dataset.scheme;
}

function customStyle(): HTMLStyleElement {
  const found = document.getElementById("collagen-custom-theme");
  if (found instanceof HTMLStyleElement) return found;
  const style = document.createElement("style");
  style.id = "collagen-custom-theme";
  document.head.append(style);
  return style;
}

/** A theme as pasted: a daisyUI theme generator link, unpacked here, or its CSS. */
export async function themeFromText(text: string): Promise<Custom | null> {
  const payload = generatorPayload(text);
  if (payload === null) return parseTheme(text);
  try {
    const binary = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const inflated = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
    return themeFromGenerator(JSON.parse(await new Response(inflated).text()) as unknown);
  } catch {
    return null;
  }
}

/** The theme on the page now, as one of the person's own to start from:
 *  every daisyUI variable, as the browser has it. */
export function currentAsCustom(): Custom {
  const computed = getComputedStyle(document.documentElement);
  const vars: Record<string, string> = {};
  for (const name of THEME_VARS) {
    const value = computed.getPropertyValue(name).trim();
    if (value && safeValue(value)) vars[name] = value;
  }
  return { scheme: computed.colorScheme.includes("dark") ? "dark" : "light", vars };
}

/** Any CSS colour as #rrggbb, for a colour input: drawn, and read back. */
export function toHex(color: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return "#000000";
  context.fillStyle = "#000";
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
  return `#${[red, green, blue].map((channel) => (channel ?? 0).toString(16).padStart(2, "0")).join("")}`;
}
