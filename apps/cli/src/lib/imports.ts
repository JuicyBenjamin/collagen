import { dirname, posix } from "node:path";
import type { Imports } from "./units";

// Which of a change's files import which — what groups the code its author
// did not name into units, and orders units building blocks first. Read
// from the files as the branch has them; only links between changed files
// matter. TypeScript and JavaScript by their relative specifiers (import,
// export … from, import(), require); PHP by its `use` names, matched to a
// changed file by the path a PSR-4 autoloader would give them. Anything
// else links nothing, and is a unit of its own.

const JS = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const JS_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

/** The relative specifiers a JS/TS file names. */
export const jsSpecifiers = (code: string): ReadonlyArray<string> => {
  const out = new Set<string>();
  const forms = [/\b(?:import|export)\s[^'"`;]*?\bfrom\s*["']([^"']+)["']/g, /\bimport\s*["']([^"']+)["']/g, /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g];
  for (const re of forms) for (const m of code.matchAll(re)) if (m[1]!.startsWith(".")) out.add(m[1]!);
  return [...out];
};

/** The class names a PHP file `use`s, as paths ("App\\Models\\User" → "App/Models/User"). */
export const phpUses = (code: string): ReadonlyArray<string> =>
  [...code.matchAll(/^\s*use\s+(?:function\s+|const\s+)?([A-Za-z_\\][A-Za-z0-9_\\]*)(?:\s+as\s+\w+)?\s*;/gm)].map((m) => m[1]!.replace(/^\\/, "").replace(/\\/g, "/"));

/** A relative specifier, from a file, to the changed file it names. */
const resolveJs = (from: string, spec: string, changed: ReadonlySet<string>): string | undefined => {
  const base = posix.normalize(posix.join(dirname(from), spec));
  const stem = base.replace(/\.(js|jsx|mjs|cjs)$/, "");
  const tries = [base, ...JS_EXTENSIONS.map((e) => `${stem}${e}`), ...JS_EXTENSIONS.map((e) => `${base}/index${e}`)];
  return tries.find((t) => changed.has(t));
};

/** A PHP class path to the changed file a PSR-4 autoloader would load it
 *  from: the longest tail of its namespace the file's path ends with. */
const resolvePhp = (path: string, changed: ReadonlyArray<string>): string | undefined => {
  const parts = path.split("/");
  for (let i = 0; i < parts.length; i++) {
    const tail = `${parts.slice(i).join("/")}.php`;
    const hit = changed.find((f) => f === tail || f.endsWith(`/${tail}`));
    if (hit) return hit;
  }
  return undefined;
};

/** Which changed files each changed file imports; `read` gives a file's
 *  text as the branch has it, or null. */
export const importsAmong = (files: ReadonlyArray<string>, read: (file: string) => string | null): Imports => {
  const changed = new Set(files);
  const php = files.filter((f) => f.endsWith(".php"));
  const out = new Map<string, Set<string>>();
  for (const f of files) {
    const code = JS.test(f) || f.endsWith(".php") ? read(f) : null;
    if (code === null) continue;
    const to = new Set<string>();
    if (JS.test(f)) for (const s of jsSpecifiers(code)) to.add(resolveJs(f, s, changed) ?? "");
    else for (const u of phpUses(code)) to.add(resolvePhp(u, php) ?? "");
    to.delete("");
    to.delete(f);
    if (to.size > 0) out.set(f, to);
  }
  return out;
};
