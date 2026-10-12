import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Context, Effect, Layer, Stream, SubscriptionRef } from "effect";
import { toolOf, type DefinitionResult, type HoverResult, type Peek, type ToolId, type ToolState } from "@collagen/review-web/data";
import { startLsp, type LspClient } from "../lib/lsp";
import { install, installed, packageDir, toolRoot, TOOLS, type LanguageTool } from "../lib/languageTools";
import { claimSlot, releaseSlot, sweepSlots, treeAt, type Slot } from "../lib/typeTrees";
import { configDir } from "./Identity";
import { commitIn, reviewTree } from "./ReviewView";

// Type hints and definition peeks on the review page, per language: each
// file's language has its own pinned server (lib/languageTools), installed
// on the person's word into collagen's folder — so a project on an older
// compiler, or with none installed, gets the same answers. The project gives
// the code: the branch under review, unpacked from the reader's clone into a
// folder of its own (git archive: the clone and its working tree are never
// touched; lib/typeTrees keeps that folder, and the server's index, from one
// start to the next), with the clone's dependencies (node_modules, vendor)
// linked in so imported packages have their types. A review's server starts
// when its page opens, not on the first hover. Nothing leaves the machine; a
// server stops when nobody has asked it anything for a while.

/** Where a tool is installed — collagen's own, never the project's. */
const toolDir = (tool: LanguageTool): string => packageDir(configDir, tool);

/** A path from the diff: relative, inside the tree, a file some language
 *  server reads. */
export const codePathOk = (file: string | undefined): file is string =>
  file !== undefined && file.length < 500 && !isAbsolute(file) && !file.split(/[\\/]/).includes("..") && toolOf(file) !== null;

const IDLE_MS = 10 * 60_000;

/** The longest declaration a peek shows before it says how much is left. */
const PEEK_LINES = 60;

interface Session {
  readonly tool: LanguageTool;
  readonly slot: Slot;
  readonly root: string;
  readonly projectPath: string;
  readonly lsp: LspClient;
  /** the server says it is ready to answer (its index is built) */
  readonly ready: Promise<void>;
  readonly indexed: { done: boolean };
  /** how much of the project it has read, as it last said (0–100), and when it said so */
  readonly progress: { at: number | null; when: number | null };
  readonly started: number;
  /** the clone's dependency folders linked into the tree (their real paths) */
  readonly deps: ReadonlyArray<string>;
  readonly opened: Set<string>;
  lastUsed: number;
}

/** How long one question waits for an index before it is answered from
 *  what the server has read so far (said as partial, and asked again by the
 *  page); and how long a server that has gone quiet without saying it is
 *  ready gets before its answers are taken as whole. */
const WAIT_MS = 2_000;
const NEVER_SAYS_MS = 3 * 60_000;
/** How long a server asked to stop gets before it is killed. */
const STOP_MS = 2_000;

/** Where a marker file says its dependencies live, relative to it: the
 *  tool's own reading (composer.json's config.vendor-dir) or its default,
 *  refused when it would leave the tree. */
const depDirAt = (deps: LanguageTool["deps"], marker: string): string | null => {
  let dir = deps.dir;
  if (deps.dirFrom) {
    try {
      dir = deps.dirFrom(readFileSync(marker, "utf8")) ?? deps.dir;
    } catch {
      // unreadable: the default
    }
  }
  return dir.length > 0 && !isAbsolute(dir) && !dir.split(/[\\/]/).includes("..") ? dir : null;
};

/** Link the clone's dependency folder (node_modules, vendor) into the
 *  unpacked tree, beside every marker file (package.json, composer.json)
 *  that has one in the clone — a monorepo has several — so imports resolve
 *  to what the reader has installed. Returns the real paths linked. */
const linkDeps = (deps: LanguageTool["deps"], projectPath: string, root: string, rel = "", depth = 0, linked: Array<string> = []): Array<string> => {
  if (depth > 4) return linked;
  const here = join(root, rel);
  const dir = existsSync(join(here, deps.marker)) ? depDirAt(deps, join(here, deps.marker)) : null;
  if (dir) {
    const theirs = join(projectPath, rel, dir);
    const at = join(here, dir);
    if (existsSync(theirs)) {
      // a kept tree has its links already; one left dangling is made again
      const link = (() => {
        try {
          return lstatSync(at).isSymbolicLink();
        } catch {
          return null;
        }
      })();
      if (link && !existsSync(at)) rmSync(at, { force: true });
      if (link === null || (link && !existsSync(at))) {
        mkdirSync(dirname(at), { recursive: true });
        symlinkSync(theirs, at, "dir");
      }
      if (lstatSync(at).isSymbolicLink() && realpathSync(at) === realpathSync(theirs)) linked.push(realpathSync(theirs));
    }
  }
  let entries: Array<string> = [];
  try {
    entries = readdirSync(here, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.isSymbolicLink() && d.name !== deps.dir && !d.name.startsWith(".")).map((d) => d.name);
  } catch {
    return linked;
  }
  for (const name of entries) linkDeps(deps, projectPath, root, join(rel, name), depth + 1, linked);
  return linked;
};

/** A declaration's range that starts on its own doc comment (PHP's servers
 *  do): the comment is the doc, and the code starts right after its `*\/` —
 *  on the same line when the declaration follows it there. */
export function splitLeadingDoc(lines: ReadonlyArray<string>, from: number, last: number): { readonly doc: string | null; readonly code: ReadonlyArray<string>; readonly line: number } | null {
  if (!lines[from]?.trim().startsWith("/**")) return null;
  let end = from;
  while (end <= last && !lines[end]!.includes("*/")) end++;
  if (end > last) return null;
  const close = lines[end]!.indexOf("*/") + 2;
  const comment = [...lines.slice(from, end), lines[end]!.slice(0, close)];
  const rest = lines[end]!.slice(close);
  const code = rest.trim() ? [rest.replace(/^\s+/, ""), ...lines.slice(end + 1, last + 1)] : lines.slice(end + 1, last + 1);
  return { doc: docAbove([...comment, ""], comment.length), code, line: rest.trim() ? end : end + 1 };
}

/** The doc comment right above line `at`, as text — whole or not at all: a
 *  JSDoc block back to its opening, or a run of // lines. Markers stripped,
 *  so the page shows it as prose rather than as comment syntax. */
export function docAbove(lines: ReadonlyArray<string>, at: number): string | null {
  let end = at - 1;
  while (end >= 0 && lines[end]!.trim() === "") end--;
  if (end < 0) return null;
  const last = lines[end]!.trim();
  let start = end;
  if (last.endsWith("*/")) {
    while (start >= 0 && !lines[start]!.includes("/*")) start--;
    if (start < 0 || !lines[start]!.includes("/**")) return null; // a plain /* */ block is not documentation
  } else if (last.startsWith("//")) {
    while (start > 0 && lines[start - 1]!.trim().startsWith("//")) start--;
  } else return null;
  const text = lines
    .slice(start, end + 1)
    .map((l) => l.replace(/^\s*\/\*\*?\s?/, "").replace(/\s*\*\/\s*$/, "").replace(/^\s*\*\s?/, "").replace(/^\s*\/\/\s?/, ""))
    .join("\n")
    .trim();
  return text.length > 0 ? text : null;
}

/** A hover's markdown, from the server's reply in any of its shapes. */
const hoverText = (result: unknown): string => {
  const contents = (result as { contents?: unknown } | null)?.contents;
  const one = (c: unknown): string => (typeof c === "string" ? c : c && typeof c === "object" && "value" in c ? String((c as { value: unknown }).value) : "");
  return Array.isArray(contents) ? contents.map(one).filter(Boolean).join("\n\n") : one(contents);
};

export class ReviewTypes extends Context.Service<ReviewTypes>()("cli/ReviewTypes", {
  make: Effect.gen(function* () {
    const sessions = new Map<string, Promise<Session>>();
    yield* Effect.sync(() => sweepSlots(tmpdir()));

    // each tool's install, one at a time, on the person's word (POST from
    // the page); and what its server asked to be shown to the person
    const installing = new Map<ToolId, Promise<string | null>>();
    const installError = new Map<ToolId, string>();
    const notices = new Map<ToolId, Array<string>>();
    // moves whenever any of those does — an install started, done or failed,
    // a server's notice — so an open page follows a tool's state live
    const moved = yield* SubscriptionRef.make(0);
    const bump = () => Effect.runSync(SubscriptionRef.update(moved, (n) => n + 1));
    const toolState = (id: ToolId): ToolState => {
      const tool = TOOLS[id];
      const about = { tool: id, language: tool.language, name: tool.name, version: tool.version, size: tool.size, ...(tool.licence ? { licence: tool.licence } : {}) };
      if (installing.has(id)) return { ...about, state: "installing" };
      if (installed(toolDir(tool), tool)) return { ...about, state: "ready", ...(notices.get(id)?.length ? { notices: notices.get(id)! } : {}) };
      return { ...about, state: "missing", ...(installError.has(id) ? { error: installError.get(id)! } : {}) };
    };
    const startInstall = (id: ToolId): ToolState => {
      const tool = TOOLS[id];
      if (!installing.has(id) && !installed(toolDir(tool), tool)) {
        installError.delete(id);
        installing.set(
          id,
          install(toolRoot(configDir, tool), tool).then((error) => {
            installing.delete(id);
            if (error) installError.set(id, error);
            bump();
            return error;
          }),
        );
        bump();
      }
      return toolState(id);
    };
    /** A tool's state, now and each time it changes. */
    const watchTool = (id: ToolId): Stream.Stream<ToolState> =>
      SubscriptionRef.changes(moved).pipe(
        Stream.map(() => toolState(id)),
        Stream.changesWith((a, b) => JSON.stringify(a) === JSON.stringify(b)),
      );

    /** Stopped, its slot given back — tree and index kept for the next. */
    const stop = (key: string): Promise<void> => {
      const s = sessions.get(key);
      sessions.delete(key);
      return (s ?? Promise.reject()).then(
        async (x) => {
          // asked to stop, so it leaves its index whole for the next server
          // in this slot; killed only if it does not go
          const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref());
          await Promise.race([x.lsp.request("shutdown", null, STOP_MS).catch(() => {}), wait(STOP_MS)]);
          x.lsp.notify("exit", null);
          await Promise.race([x.lsp.exited, wait(STOP_MS)]);
          x.lsp.close();
          releaseSlot(x.slot);
        },
        () => {},
      );
    };

    // a server nobody has asked anything for ten minutes is stopped
    const sweep = setInterval(() => {
      for (const [key, s] of sessions)
        void s.then(
          (x) => {
            if (Date.now() - x.lastUsed > IDLE_MS) void stop(key);
          },
          () => sessions.delete(key),
        );
    }, 60_000);
    sweep.unref();
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        clearInterval(sweep);
        // collagen is going: no time to ask, each is killed and its slot given back
        for (const s of sessions.values())
          void s.then(
            (x) => {
              x.lsp.close();
              releaseSlot(x.slot);
            },
            () => {},
          );
        sessions.clear();
      }),
    );

    const start = async (tool: LanguageTool, projectPath: string, commit: string): Promise<Session> => {
      const slot = claimSlot(tmpdir(), projectPath, tool.id);
      try {
        return await startIn(slot, tool, projectPath, commit);
      } catch (e) {
        releaseSlot(slot);
        throw e;
      }
    };
    const startIn = async (slot: Slot, tool: LanguageTool, projectPath: string, commit: string): Promise<Session> => {
      const root = slot.tree;
      await treeAt(projectPath, commit, root, slot.stamp);
      const deps = linkDeps(tool.deps, projectPath, root);
      // ready when the server says so — never on a timer: until then its
      // answers are partial, not answers that look final
      const indexed = { done: !tool.readyWhen };
      const progress = { at: null as number | null, when: null as number | null };
      let isReady = () => {};
      const ready = tool.readyWhen
        ? new Promise<void>((resolve) => {
            isReady = () => {
              indexed.done = true;
              resolve();
            };
          })
        : Promise.resolve();
      const lsp = startLsp(process.execPath, [join(toolDir(tool), tool.bin), ...tool.args], root, {
        onRequest: (method, params) =>
          method === "workspace/configuration" ? ((params as { items?: Array<unknown> } | null)?.items ?? []).map(() => tool.settings ?? null) : null,
        onNotification: (method, params) => {
          if (tool.readyWhen?.(method, params)) isReady();
          const value = (params as { value?: { kind?: string; percentage?: unknown } } | null)?.value;
          if (method === "$/progress") progress.when = Date.now();
          if (method === "$/progress" && value?.kind === "report" && typeof value.percentage === "number") progress.at = Math.max(0, Math.min(100, Math.round(value.percentage)));
          // what the server asks to show the person is shown, never swallowed
          if (method === "window/showMessage") {
            const text = String((params as { message?: unknown } | null)?.message ?? "").trim();
            const seen = notices.get(tool.id) ?? [];
            if (text && !seen.includes(text)) {
              notices.set(tool.id, [...seen, text].slice(-5));
              bump();
            }
          }
        },
      });
      const uri = pathToFileURL(root).href;
      await lsp.request("initialize", {
        processId: process.pid,
        rootUri: uri,
        workspaceFolders: [{ uri, name: "review" }],
        capabilities: { textDocument: { hover: { contentFormat: ["markdown", "plaintext"] }, definition: { linkSupport: true } }, window: { workDoneProgress: true } },
        ...(tool.initializationOptions ? { initializationOptions: tool.initializationOptions(slot.storage) } : {}),
      });
      lsp.notify("initialized", {});
      return { tool, slot, root, projectPath, lsp, ready, indexed, progress, started: Date.now(), deps, opened: new Set(), lastUsed: Date.now() };
    };

    /** A language's server for a review's code at `commit` — the commit the
     *  page shows, never the branch's tip now, so an answer is about the code
     *  on screen — started on first use and kept per commit. */
    const session = Effect.fn("ReviewTypes.session")(function* (ticketId: string, tool: LanguageTool, commit: string) {
      const tree = yield* reviewTree(ticketId);
      if (typeof tree === "string") return tree;
      if (!(yield* commitIn(tree.projectPath, commit))) return "the commit this page shows is not in your clone";
      const prefix = `${ticketId.slice(0, 8)}-${tool.id}-`;
      const key = `${prefix}${commit.slice(0, 12)}`;
      if (!sessions.has(key)) {
        // the review's server at another commit gives its slot back first,
        // so this one starts from its tree and index
        const before = Promise.all([...sessions.keys()].filter((k) => k.startsWith(prefix)).map(stop));
        const started = before.then(() => start(tool, tree.projectPath, commit));
        started.catch(() => sessions.delete(key));
        sessions.set(key, started);
      }
      return yield* Effect.tryPromise({ try: () => sessions.get(key)!, catch: (e) => (e instanceof Error ? e.message : String(e)) }).pipe(
        Effect.catch((why) => Effect.succeed(`the ${tool.name} server could not start: ${why}`)),
      );
    });

    /** Ask the file's server about a position in it; opens the file for it
     *  first (a server answers about open documents). */
    const ask = Effect.fn("ReviewTypes.ask")(function* (ticketId: string, file: string, line: number, col: number, commit: string, method: string) {
      const id = toolOf(file);
      if (id === null) return { _tag: "failed", error: `no language server reads ${extname(file) || file}` } as const;
      const tool = TOOLS[id];
      if (!installed(toolDir(tool), tool)) return { _tag: "missing" } as const;
      const s = yield* session(ticketId, tool, commit);
      if (typeof s === "string") return { _tag: "failed", error: s } as const;
      s.lastUsed = Date.now();
      const path = join(s.root, file);
      if (!existsSync(path)) return { _tag: "failed", error: `${file} is not on the branch under review` } as const;
      const uri = pathToFileURL(path).href;
      // a moment for an index nearly built; then what it has read so far,
      // said as partial — never "ask again": the page asks again itself
      if (!s.indexed.done) yield* Effect.promise(() => Promise.race([s.ready, new Promise<void>((r) => setTimeout(r, WAIT_MS).unref())]));
      // a server still saying how far it has read is still reading, however long it takes
      if (!s.indexed.done && Date.now() - (s.progress.when ?? s.started) >= NEVER_SAYS_MS) s.indexed.done = true;
      const partial = s.indexed.done ? null : { partial: true as const, ...(s.progress.at !== null ? { progress: s.progress.at } : {}) };
      if (!s.opened.has(uri)) {
        s.lsp.notify("textDocument/didOpen", { textDocument: { uri, languageId: tool.languageId(extname(file)), version: 1, text: readFileSync(path, "utf8") } });
        s.opened.add(uri);
      }
      // the page counts lines from 1 and characters from 0, as editors show them
      return yield* Effect.tryPromise({
        try: () => s.lsp.request(method, { textDocument: { uri }, position: { line: line - 1, character: col } }),
        catch: (e) => (e instanceof Error ? e.message : String(e)),
      }).pipe(
        Effect.map((result) => ({ _tag: "ok", result, session: s, partial }) as const),
        Effect.catch((error) => Effect.succeed({ _tag: "failed", error } as const)),
      );
    });

    const hover = Effect.fn("ReviewTypes.hover")(function* (ticketId: string, file: string, line: number, col: number, commit: string) {
      const r = yield* ask(ticketId, file, line, col, commit, "textDocument/hover");
      if (r._tag === "missing") return { missing: true } satisfies HoverResult;
      if (r._tag === "failed") return { error: r.error } satisfies HoverResult;
      const markdown = hoverText(r.result);
      return (markdown ? { markdown, ...r.partial } : { none: true, ...r.partial }) satisfies HoverResult;
    });

    /** Where a symbol is declared, and the declaration itself: the target's
     *  whole range (a function with its body), capped, with where it lives —
     *  in the branch, in a dependency, or in the language itself. */
    const definition = Effect.fn("ReviewTypes.definition")(function* (ticketId: string, file: string, line: number, col: number, commit: string) {
      const r = yield* ask(ticketId, file, line, col, commit, "textDocument/definition");
      if (r._tag === "missing") return { missing: true } satisfies DefinitionResult;
      if (r._tag === "failed") return { error: r.error } satisfies DefinitionResult;
      const links = (Array.isArray(r.result) ? r.result : r.result ? [r.result] : []) as Array<{
        targetUri?: string;
        uri?: string;
        targetRange?: { start: { line: number }; end: { line: number } };
        range?: { start: { line: number }; end: { line: number } };
      }>;
      const { root, projectPath, tool, deps } = r.session;
      const realRoot = realpathSync(root);
      const realTool = (() => {
        try {
          return realpathSync(toolDir(tool));
        } catch {
          return toolDir(tool);
        }
      })();
      const peeks = links.slice(0, 8).flatMap((l): Array<Peek> => {
        const target = l.targetUri ?? l.uri ?? "";
        const range = l.targetRange ?? l.range;
        if (!range) return [];
        // not a file at all: the language's library, bundled in its server
        if (!target.startsWith("file:")) return [{ file: target.replace(/^bundled:\/\/\/libs\//, "typescript/lib/"), where: "builtin", builtInto: tool.language, line: range.start.line + 1, doc: null, code: null, more: 0 }];
        const path = fileURLToPath(target);
        const real = (() => {
          try {
            return realpathSync(path);
          } catch {
            return path;
          }
        })();
        const lines = readFileSync(real, "utf8").split("\n");
        // a range that starts on its own doc comment: the comment is the doc
        const lifted = splitLeadingDoc(lines, range.start.line, range.end.line);
        const from = lifted ? lifted.line : range.start.line;
        const code = lifted ? lifted.code : lines.slice(from, range.end.line + 1);
        const shown = code.slice(0, PEEK_LINES);
        const body = { line: from + 1, doc: lifted ? lifted.doc : docAbove(lines, from), code: shown.join("\n"), more: code.length - shown.length };
        // a file of the server itself: the language's own declarations (stubs)
        if (real.startsWith(realTool + sep)) return [{ file: relative(realTool, real).replace(/^lib\/stubs?\//, ""), where: "builtin", builtInto: tool.language, ...body }];
        // a dependency's file by the package, not by the folder it sits in:
        // one of the folders linked from the clone, wherever it is configured
        const depRoot = deps.find((d) => real.startsWith(d + sep));
        if (depRoot) return [{ file: relative(depRoot, real), where: "package", ...body }];
        const inTree = real.startsWith(realRoot + sep);
        const full = inTree ? relative(realRoot, real) : real.startsWith(projectPath + sep) ? relative(projectPath, real) : real;
        const dep = `${tool.deps.dir}${sep}`;
        const inPackage = full.split(sep).includes(tool.deps.dir);
        return [{ file: inPackage ? full.slice(full.lastIndexOf(dep) + dep.length) : full, where: inPackage ? "package" : "branch", ...body }];
      });
      // a name that is both a value and a namespace of types (Effect.fn):
      // the value — what the code calls — first
      const typesOnly = (p: Peek) => /^\s*(export\s+)?(declare\s+)?(namespace|module)\b/m.test((p.code ?? "").replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "").trimStart().split("\n")[0] ?? "");
      return { peeks: [...peeks.filter((p) => !typesOnly(p)), ...peeks.filter(typesOnly)], ...r.partial } satisfies DefinitionResult;
    });

    /** The review's server for a language, started as its page opens — so
     *  the index is being read while the reader reads the diff, not from
     *  their first hover. Nothing when the tool is not installed. */
    const warm = Effect.fn("ReviewTypes.warm")(function* (ticketId: string, id: ToolId, commit: string) {
      const tool = TOOLS[id];
      if (!installed(toolDir(tool), tool)) return;
      const s = yield* session(ticketId, tool, commit);
      if (typeof s !== "string") s.lastUsed = Date.now();
    });

    return { hover, definition, warm, watchTool, startInstall: (id: ToolId) => Effect.sync(() => startInstall(id)) } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}

/** The tool a page names, if it is one collagen has. */
export const toolNamed = (name: unknown): ToolId | null => (typeof name === "string" && Object.hasOwn(TOOLS, name) ? (name as ToolId) : null);
