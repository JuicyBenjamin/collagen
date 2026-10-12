import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Context, Effect, Layer, Stream, SubscriptionRef } from "effect";
import { toolOf, type DefinitionResult, type HoverResult, type Peek, type ToolId, type ToolState } from "@collagen/review-web/data";
import { startLsp, type LspClient } from "../lib/lsp";
import { install, installed, packageDir, serverPath, stripTree, toolRoot, TOOLS, type LanguageTool } from "../lib/languageTools";
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
// linked in so imported packages have their types — Rust's crates come from
// the reader's own ~/.cargo instead. A review's server starts when its page
// opens, not on the first hover. Nothing leaves the machine; a server stops
// when nobody has asked it anything for a while.

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
const depDirAt = (deps: NonNullable<LanguageTool["deps"]>, marker: string): string | null => {
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
const linkDeps = (deps: NonNullable<LanguageTool["deps"]>, projectPath: string, root: string, rel = "", depth = 0, linked: Array<string> = []): Array<string> => {
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
    entries = readdirSync(here, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && entry.name !== deps.dir && !entry.name.startsWith(".")).map((entry) => entry.name);
  } catch {
    return linked;
  }
  for (const name of entries) linkDeps(deps, projectPath, root, join(rel, name), depth + 1, linked);
  return linked;
};

/** A declaration's range that starts on its own doc comment (PHP's and
 *  Rust's servers do): the comment is the doc, and the code starts right
 *  after its `*\/` — on the same line when the declaration follows it there
 *  — or after the last of its `///` lines. */
export function splitLeadingDoc(lines: ReadonlyArray<string>, from: number, last: number): { readonly doc: string | null; readonly code: ReadonlyArray<string>; readonly line: number } | null {
  if (lines[from]?.trim().startsWith("///")) {
    let end = from;
    while (end < last && lines[end + 1]!.trim().startsWith("///")) end++;
    return { doc: docAbove(lines.slice(from, end + 1), end + 1 - from), code: lines.slice(end + 1, last + 1), line: end + 1 };
  }
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
 *  JSDoc block back to its opening, or a run of // lines (Rust's /// too).
 *  Markers stripped, so the page shows it as prose rather than as comment
 *  syntax. */
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
    .map((line) => line.replace(/^\s*\/\*\*?\s?/, "").replace(/\s*\*\/\s*$/, "").replace(/^\s*\*\s?/, "").replace(/^\s*\/\/[/!]?\s?/, ""))
    .join("\n")
    .trim();
  return text.length > 0 ? text : null;
}

/** A hover's markdown, from the server's reply in any of its shapes. */
const hoverText = (result: unknown): string => {
  const contents = (result as { contents?: unknown } | null)?.contents;
  const one = (part: unknown): string => (typeof part === "string" ? part : part && typeof part === "object" && "value" in part ? String((part as { value: unknown }).value) : "");
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
    // what the machine lacks for a tool (Rust's toolchain), checked when a
    // page follows the tool and before an install or a question
    const lacking = new Map<ToolId, string | null>();
    // moves whenever any of those does — an install started, done or failed,
    // a server's notice — so an open page follows a tool's state live
    const moved = yield* SubscriptionRef.make(0);
    const bump = () => Effect.runSync(SubscriptionRef.update(moved, (count) => count + 1));
    const checkNeeds = async (id: ToolId): Promise<string | null> => {
      const needs = (await TOOLS[id].needs?.()) ?? null;
      if (lacking.get(id) !== needs) {
        lacking.set(id, needs);
        bump();
      }
      return needs;
    };
    const toolState = (id: ToolId): ToolState => {
      const tool = TOOLS[id];
      const about = { tool: id, language: tool.language, name: tool.name, version: tool.version, size: tool.size, ...(tool.licence ? { licence: tool.licence } : {}) };
      const needs = lacking.get(id);
      if (needs) return { ...about, state: "needs", needs };
      if (installing.has(id)) return { ...about, state: "installing" };
      if (installed(toolDir(tool), tool)) return { ...about, state: "ready", ...(notices.get(id)?.length ? { notices: notices.get(id)! } : {}) };
      return { ...about, state: "missing", ...(installError.has(id) ? { error: installError.get(id)! } : {}) };
    };
    const startInstall = (id: ToolId): ToolState => {
      const tool = TOOLS[id];
      if (!lacking.get(id) && !installing.has(id) && !installed(toolDir(tool), tool)) {
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
    /** A tool's state, now and each time it changes — what the machine
     *  lacks for it checked afresh first. */
    const watchTool = (id: ToolId): Stream.Stream<ToolState> =>
      Stream.unwrap(
        Effect.promise(() => checkNeeds(id)).pipe(
          Effect.as(
            SubscriptionRef.changes(moved).pipe(
              Stream.map(() => toolState(id)),
              Stream.changesWith((previous, next) => JSON.stringify(previous) === JSON.stringify(next)),
            ),
          ),
        ),
      );

    /** Stopped, its slot given back — tree and index kept for the next. */
    const stop = (key: string): Promise<void> => {
      const starting = sessions.get(key);
      sessions.delete(key);
      return (starting ?? Promise.reject()).then(
        async (server) => {
          // asked to stop, so it leaves its index whole for the next server
          // in this slot; killed only if it does not go
          const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds).unref());
          await Promise.race([server.lsp.request("shutdown", null, STOP_MS).catch(() => {}), wait(STOP_MS)]);
          server.lsp.notify("exit", null);
          await Promise.race([server.lsp.exited, wait(STOP_MS)]);
          server.lsp.close();
          releaseSlot(server.slot);
        },
        () => {},
      );
    };

    // a server nobody has asked anything for ten minutes is stopped
    const sweep = setInterval(() => {
      for (const [key, starting] of sessions)
        void starting.then(
          (server) => {
            if (Date.now() - server.lastUsed > IDLE_MS) void stop(key);
          },
          () => sessions.delete(key),
        );
    }, 60_000);
    sweep.unref();
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        clearInterval(sweep);
        // collagen is going: no time to ask, each is killed and its slot given back
        for (const starting of sessions.values())
          void starting.then(
            (server) => {
              server.lsp.close();
              releaseSlot(server.slot);
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
      } catch (error) {
        releaseSlot(slot);
        throw error;
      }
    };
    const startIn = async (slot: Slot, tool: LanguageTool, projectPath: string, commit: string): Promise<Session> => {
      const root = slot.tree;
      await treeAt(projectPath, commit, root, slot.stamp);
      // what the branch could make its toolchain run goes before anything reads the tree
      if (tool.strip) stripTree(root, tool.strip);
      const deps = tool.deps ? linkDeps(tool.deps, projectPath, root) : [];
      // ready when the server says so — never on a timer: an index still
      // being built answers "ask again", not an answer that looks final
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
      // an npm package's server runs on collagen's Node; a download is the binary
      const server = serverPath(configDir, tool);
      const [command, args] = tool.download ? [server, tool.args] : [process.execPath, [server, ...tool.args]];
      const lsp = startLsp(command, args, root, {
        ...(tool.spawnEnv ? { env: tool.spawnEnv(slot.storage) } : {}),
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
        capabilities: {
          textDocument: { hover: { contentFormat: ["markdown", "plaintext"] }, definition: { linkSupport: true } },
          window: { workDoneProgress: true },
          // rust-analyzer says when it is loaded and indexed (quiescent)
          experimental: { serverStatusNotification: true },
        },
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
        const before = Promise.all([...sessions.keys()].filter((sessionKey) => sessionKey.startsWith(prefix)).map(stop));
        const started = before.then(() => start(tool, tree.projectPath, commit));
        started.catch(() => sessions.delete(key));
        sessions.set(key, started);
      }
      return yield* Effect.tryPromise({ try: () => sessions.get(key)!, catch: (error) => (error instanceof Error ? error.message : String(error)) }).pipe(
        Effect.catch((why) => Effect.succeed(`the ${tool.name} server could not start: ${why}`)),
      );
    });

    /** Ask the file's server about a position in it; opens the file for it
     *  first (a server answers about open documents). */
    const ask = Effect.fn("ReviewTypes.ask")(function* (ticketId: string, file: string, line: number, col: number, commit: string, method: string) {
      const id = toolOf(file);
      if (id === null) return { _tag: "failed", error: `no language server reads ${extname(file) || file}` } as const;
      const tool = TOOLS[id];
      const needs = lacking.has(id) ? lacking.get(id) : yield* Effect.promise(() => checkNeeds(id));
      if (needs) return { _tag: "failed", error: `${tool.language} type hints need ${needs}` } as const;
      if (!installed(toolDir(tool), tool)) return { _tag: "missing" } as const;
      const server = yield* session(ticketId, tool, commit);
      if (typeof server === "string") return { _tag: "failed", error: server } as const;
      server.lastUsed = Date.now();
      const path = join(server.root, file);
      if (!existsSync(path)) return { _tag: "failed", error: `${file} is not on the branch under review` } as const;
      const uri = pathToFileURL(path).href;
      // a moment for an index nearly built; then what it has read so far,
      // said as partial — never "ask again": the page asks again itself
      if (!server.indexed.done) yield* Effect.promise(() => Promise.race([server.ready, new Promise<void>((resolve) => setTimeout(resolve, WAIT_MS).unref())]));
      // a server still saying how far it has read is still reading, however long it takes
      if (!server.indexed.done && Date.now() - (server.progress.when ?? server.started) >= NEVER_SAYS_MS) server.indexed.done = true;
      const partial = server.indexed.done ? null : { partial: true as const, ...(server.progress.at !== null ? { progress: server.progress.at } : {}) };
      if (!server.opened.has(uri)) {
        server.lsp.notify("textDocument/didOpen", { textDocument: { uri, languageId: tool.languageId(extname(file)), version: 1, text: readFileSync(path, "utf8") } });
        server.opened.add(uri);
      }
      // the page counts lines from 1 and characters from 0, as editors show them
      return yield* Effect.tryPromise({
        try: () => server.lsp.request(method, { textDocument: { uri }, position: { line: line - 1, character: col } }),
        catch: (error) => (error instanceof Error ? error.message : String(error)),
      }).pipe(
        Effect.map((result) => ({ _tag: "ok", result, session: server, partial }) as const),
        Effect.catch((error) => Effect.succeed({ _tag: "failed", error } as const)),
      );
    });

    const hover = Effect.fn("ReviewTypes.hover")(function* (ticketId: string, file: string, line: number, col: number, commit: string) {
      const answer = yield* ask(ticketId, file, line, col, commit, "textDocument/hover");
      if (answer._tag === "missing") return { missing: true } satisfies HoverResult;
      if (answer._tag === "failed") return { error: answer.error } satisfies HoverResult;
      const markdown = hoverText(answer.result);
      return (markdown ? { markdown, ...answer.partial } : { none: true, ...answer.partial }) satisfies HoverResult;
    });

    /** Where a symbol is declared, and the declaration itself: the target's
     *  whole range (a function with its body), capped, with where it lives —
     *  in the branch, in a dependency, or in the language itself. */
    const definition = Effect.fn("ReviewTypes.definition")(function* (ticketId: string, file: string, line: number, col: number, commit: string) {
      const answer = yield* ask(ticketId, file, line, col, commit, "textDocument/definition");
      if (answer._tag === "missing") return { missing: true } satisfies DefinitionResult;
      if (answer._tag === "failed") return { error: answer.error } satisfies DefinitionResult;
      const links = (Array.isArray(answer.result) ? answer.result : answer.result ? [answer.result] : []) as Array<{
        targetUri?: string;
        uri?: string;
        targetRange?: { start: { line: number }; end: { line: number } };
        range?: { start: { line: number }; end: { line: number } };
      }>;
      const { root, projectPath, tool, deps } = answer.session;
      const realRoot = realpathSync(root);
      const realTool = (() => {
        try {
          return realpathSync(toolDir(tool));
        } catch {
          return toolDir(tool);
        }
      })();
      const peeks = links.slice(0, 8).flatMap((link): Array<Peek> => {
        const target = link.targetUri ?? link.uri ?? "";
        const range = link.targetRange ?? link.range;
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
        // the tool knows its language's places (Rust's std, cargo's registry)
        // — never for the branch's own files, wherever its clone sits
        const placed = real.startsWith(realRoot + sep) ? null : tool.place?.(real);
        if (placed) return [{ file: placed.file, where: placed.where, ...(placed.where === "builtin" ? { builtInto: tool.language } : {}), ...body }];
        // a file of the server itself: the language's own declarations (stubs)
        if (real.startsWith(realTool + sep)) return [{ file: relative(realTool, real).replace(/^lib\/stubs?\//, ""), where: "builtin", builtInto: tool.language, ...body }];
        // a dependency's file by the package, not by the folder it sits in:
        // one of the folders linked from the clone, wherever it is configured
        const depRoot = deps.find((dependency) => real.startsWith(dependency + sep));
        if (depRoot) return [{ file: relative(depRoot, real), where: "package", ...body }];
        const inTree = real.startsWith(realRoot + sep);
        const full = inTree ? relative(realRoot, real) : real.startsWith(projectPath + sep) ? relative(projectPath, real) : real;
        const depDir = tool.deps?.dir;
        const dep = `${depDir}${sep}`;
        const inPackage = depDir !== undefined && full.split(sep).includes(depDir);
        return [{ file: inPackage ? full.slice(full.lastIndexOf(dep) + dep.length) : full, where: inPackage ? "package" : "branch", ...body }];
      });
      // a name that is both a value and a namespace of types (Effect.fn):
      // the value — what the code calls — first
      const typesOnly = (peek: Peek) => /^\s*(export\s+)?(declare\s+)?(namespace|module)\b/m.test((peek.code ?? "").replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "").trimStart().split("\n")[0] ?? "");
      return { peeks: [...peeks.filter((peek) => !typesOnly(peek)), ...peeks.filter(typesOnly)], ...answer.partial } satisfies DefinitionResult;
    });

    /** The review's server for a language, started as its page opens — so
     *  the index is being read while the reader reads the diff, not from
     *  their first hover. Nothing when the tool is not installed. */
    const warm = Effect.fn("ReviewTypes.warm")(function* (ticketId: string, id: ToolId, commit: string) {
      const tool = TOOLS[id];
      if (!installed(toolDir(tool), tool)) return;
      const server = yield* session(ticketId, tool, commit);
      if (typeof server !== "string") server.lastUsed = Date.now();
    });

    return { hover, definition, warm, watchTool, startInstall: (id: ToolId) => Effect.sync(() => startInstall(id)) } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}

/** The tool a page names, if it is one collagen has. */
export const toolNamed = (name: unknown): ToolId | null => (typeof name === "string" && Object.hasOwn(TOOLS, name) ? (name as ToolId) : null);
