import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Context, Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { toolOf, type DefinitionResult, type HoverResult, type Peek, type ToolId, type ToolState } from "@collagen/review-web/data";
import { startLsp, type LspClient } from "../lib/lsp";
import { install, installed, packageDir, toolRoot, TOOLS, type LanguageTool } from "../lib/languageTools";
import { configDir } from "./Identity";
import { localHost, reviewTree, ticketIdOk } from "./ReviewView";

// Type hints and definition peeks on the review page, per language: each
// file's language has its own pinned server (lib/languageTools), installed
// on the person's word into collagen's folder — so a project on an older
// compiler, or with none installed, gets the same answers. The project gives
// the code: the branch under review, unpacked from the reader's clone into a
// folder of its own (git archive: the clone and its working tree are never
// touched), with the clone's dependencies (node_modules, vendor) linked in
// so imported packages have their types. Nothing leaves the machine; a
// server stops when nobody has asked it anything for a while.

/** Where a tool is installed — collagen's own, never the project's. */
const toolDir = (tool: LanguageTool): string => packageDir(configDir, tool);

/** A path from the diff: relative, inside the tree, a file some language
 *  server reads. */
export const codePathOk = (file: string | undefined): file is string =>
  file !== undefined && file.length < 500 && !isAbsolute(file) && !file.split(/[\\/]/).includes("..") && toolOf(file) !== null;

const IDLE_MS = 10 * 60_000;

/** Unpacked trees live under the process that made them, so several
 *  instances (profiles) never touch each other's — and a process that died
 *  without cleaning up (killed) has its trees swept by the next one. */
const TREES = join(tmpdir(), "collagen-review");
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};
const sweepDead = (): void => {
  let dirs: Array<string> = [];
  try {
    dirs = readdirSync(TREES);
  } catch {
    return;
  }
  for (const d of dirs) {
    const pid = Number(d);
    if (!Number.isInteger(pid) || (pid !== process.pid && !alive(pid))) rmSync(join(TREES, d), { recursive: true, force: true });
  }
};
/** The longest declaration a peek shows before it says how much is left. */
const PEEK_LINES = 60;

interface Session {
  readonly tool: LanguageTool;
  readonly root: string;
  /** what the server keeps for itself (an index), beside the tree, not in it */
  readonly storage: string;
  readonly projectPath: string;
  readonly lsp: LspClient;
  /** the server says it is ready to answer (its index is built) */
  readonly ready: Promise<void>;
  readonly indexed: { done: boolean };
  readonly started: number;
  /** the clone's dependency folders linked into the tree (their real paths) */
  readonly deps: ReadonlyArray<string>;
  readonly opened: Set<string>;
  lastUsed: number;
}

/** How long one question waits for an index before the page is told to
 *  ask again; and how long a server that never says it is ready gets
 *  before it is answered from anyway (its answers then marked partial). */
const WAIT_MS = 15_000;
const NEVER_SAYS_MS = 3 * 60_000;

/** Unpack a commit of the clone at `projectPath` into `dir`: git archive into
 *  tar, nothing written to the repository. */
const unpack = (projectPath: string, commit: string, dir: string): Promise<void> =>
  new Promise((resolve, reject) => {
    mkdirSync(dir, { recursive: true });
    const git = spawn("git", ["-C", projectPath, "archive", "--format=tar", commit], { stdio: ["ignore", "pipe", "ignore"] });
    const tar = spawn("tar", ["-x", "-C", dir], { stdio: ["pipe", "ignore", "ignore"] });
    git.stdout.pipe(tar.stdin);
    git.on("error", reject);
    tar.on("error", reject);
    tar.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`could not unpack ${commit} (tar exit ${code})`))));
  });

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
    if (existsSync(theirs) && !existsSync(join(here, dir))) {
      mkdirSync(dirname(join(here, dir)), { recursive: true });
      symlinkSync(theirs, join(here, dir), "dir");
      linked.push(realpathSync(theirs));
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
    yield* Effect.sync(sweepDead);

    // each tool's install, one at a time, on the person's word (POST from
    // the page); and what its server asked to be shown to the person
    const installing = new Map<ToolId, Promise<string | null>>();
    const installError = new Map<ToolId, string>();
    const notices = new Map<ToolId, Array<string>>();
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
            return error;
          }),
        );
      }
      return toolState(id);
    };

    const stop = (key: string) => {
      const s = sessions.get(key);
      sessions.delete(key);
      void s?.then((x) => {
        x.lsp.close();
        rmSync(x.root, { recursive: true, force: true });
        rmSync(x.storage, { recursive: true, force: true });
      }, () => {});
    };

    // a server nobody has asked anything for ten minutes is stopped
    const sweep = setInterval(() => {
      for (const [key, s] of sessions) void s.then((x) => Date.now() - x.lastUsed > IDLE_MS && stop(key), () => sessions.delete(key));
    }, 60_000);
    sweep.unref();
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        clearInterval(sweep);
        for (const key of [...sessions.keys()]) stop(key);
      }),
    );

    const start = async (tool: LanguageTool, projectPath: string, commit: string, key: string): Promise<Session> => {
      const root = join(TREES, String(process.pid), key);
      const storage = `${root}.store`;
      rmSync(root, { recursive: true, force: true });
      rmSync(storage, { recursive: true, force: true });
      mkdirSync(storage, { recursive: true });
      await unpack(projectPath, commit, root);
      const deps = linkDeps(tool.deps, projectPath, root);
      // ready when the server says so — never on a timer: an index still
      // being built answers "ask again", not an answer that looks final
      const indexed = { done: !tool.readyWhen };
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
          // what the server asks to show the person is shown, never swallowed
          if (method === "window/showMessage") {
            const text = String((params as { message?: unknown } | null)?.message ?? "").trim();
            const seen = notices.get(tool.id) ?? [];
            if (text && !seen.includes(text)) notices.set(tool.id, [...seen, text].slice(-5));
          }
        },
      });
      const uri = pathToFileURL(root).href;
      await lsp.request("initialize", {
        processId: process.pid,
        rootUri: uri,
        workspaceFolders: [{ uri, name: "review" }],
        capabilities: { textDocument: { hover: { contentFormat: ["markdown", "plaintext"] }, definition: { linkSupport: true } }, window: { workDoneProgress: true } },
        ...(tool.initializationOptions ? { initializationOptions: tool.initializationOptions(storage) } : {}),
      });
      lsp.notify("initialized", {});
      return { tool, root, storage, projectPath, lsp, ready, indexed, started: Date.now(), deps, opened: new Set(), lastUsed: Date.now() };
    };

    /** A language's server for a review's branch, started on first use and
     *  kept per commit — a branch that moves gets a fresh one. */
    const session = Effect.fn("ReviewTypes.session")(function* (ticketId: string, tool: LanguageTool) {
      const tree = yield* reviewTree(ticketId);
      if (typeof tree === "string") return tree;
      const prefix = `${ticketId.slice(0, 8)}-${tool.id}-`;
      const key = `${prefix}${tree.commit.slice(0, 12)}`;
      if (!sessions.has(key)) {
        for (const k of [...sessions.keys()]) if (k.startsWith(prefix)) stop(k);
        const started = start(tool, tree.projectPath, tree.commit, key);
        started.catch(() => sessions.delete(key));
        sessions.set(key, started);
      }
      return yield* Effect.tryPromise({ try: () => sessions.get(key)!, catch: (e) => (e instanceof Error ? e.message : String(e)) }).pipe(
        Effect.catch((why) => Effect.succeed(`the ${tool.name} server could not start: ${why}`)),
      );
    });

    /** Ask the file's server about a position in it; opens the file for it
     *  first (a server answers about open documents). */
    const ask = Effect.fn("ReviewTypes.ask")(function* (ticketId: string, file: string, line: number, col: number, method: string) {
      const id = toolOf(file);
      if (id === null) return { _tag: "failed", error: `no language server reads ${extname(file) || file}` } as const;
      const tool = TOOLS[id];
      if (!installed(toolDir(tool), tool)) return { _tag: "missing" } as const;
      const s = yield* session(ticketId, tool);
      if (typeof s === "string") return { _tag: "failed", error: s } as const;
      s.lastUsed = Date.now();
      const path = join(s.root, file);
      if (!existsSync(path)) return { _tag: "failed", error: `${file} is not on the branch under review` } as const;
      const uri = pathToFileURL(path).href;
      if (!s.indexed.done) {
        const done = yield* Effect.promise(() => Promise.race([s.ready.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), WAIT_MS).unref())]));
        if (!done && Date.now() - s.started < NEVER_SAYS_MS) return { _tag: "indexing" } as const;
      }
      const partial = !s.indexed.done;
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

    const hover = Effect.fn("ReviewTypes.hover")(function* (ticketId: string, file: string, line: number, col: number) {
      const r = yield* ask(ticketId, file, line, col, "textDocument/hover");
      if (r._tag === "missing") return { missing: true } satisfies HoverResult;
      if (r._tag === "indexing") return { indexing: true } satisfies HoverResult;
      if (r._tag === "failed") return { error: r.error } satisfies HoverResult;
      const markdown = hoverText(r.result);
      const partial = r.partial ? { partial: true as const } : {};
      return (markdown ? { markdown, ...partial } : { none: true, ...partial }) satisfies HoverResult;
    });

    /** Where a symbol is declared, and the declaration itself: the target's
     *  whole range (a function with its body), capped, with where it lives —
     *  in the branch, in a dependency, or in the language itself. */
    const definition = Effect.fn("ReviewTypes.definition")(function* (ticketId: string, file: string, line: number, col: number) {
      const r = yield* ask(ticketId, file, line, col, "textDocument/definition");
      if (r._tag === "missing") return { missing: true } satisfies DefinitionResult;
      if (r._tag === "indexing") return { indexing: true } satisfies DefinitionResult;
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
      return { peeks: [...peeks.filter((p) => !typesOnly(p)), ...peeks.filter(typesOnly)], ...(r.partial ? { partial: true as const } : {}) } satisfies DefinitionResult;
    });

    return { hover, definition, toolState: (id: ToolId) => Effect.sync(() => toolState(id)), startInstall: (id: ToolId) => Effect.sync(() => startInstall(id)) } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}

const position = (url: string) => {
  const q = new URL(url, "http://localhost").searchParams;
  const file = q.get("file") ?? undefined;
  const line = Number(q.get("line"));
  const col = Number(q.get("col"));
  return codePathOk(file) && Number.isInteger(line) && line > 0 && Number.isInteger(col) && col >= 0 ? { file, line, col } : null;
};

/** Asked from the page itself, not from anywhere a browser can be sent: a
 *  cross-site form or fetch cannot set this header without a CORS preflight
 *  this server never answers, and a page elsewhere is not localhost. */
const fromThePage = (headers: Record<string, string | undefined>): boolean =>
  headers["x-collagen"] === "install" && (headers["origin"] === undefined || /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(headers["origin"]));

/** The tool a /review-tools/<tool> path names, if it is one. */
const toolNamed = (name: string | undefined): ToolId | null => (name !== undefined && Object.hasOwn(TOOLS, name) ? (name as ToolId) : null);

export const ReviewTypesRoutes = Layer.mergeAll(
  HttpRouter.add("GET", "/review-tools/:tool", (request) =>
    Effect.gen(function* () {
      if (!localHost(request.headers["host"])) return HttpServerResponse.text("forbidden", { status: 403 });
      const tool = toolNamed((yield* HttpRouter.params).tool);
      if (!tool) return HttpServerResponse.text("not found", { status: 404 });
      return HttpServerResponse.jsonUnsafe(yield* (yield* ReviewTypes).toolState(tool));
    }),
  ),
  HttpRouter.add("POST", "/review-tools/:tool", (request) =>
    Effect.gen(function* () {
      if (!localHost(request.headers["host"]) || !fromThePage(request.headers)) return HttpServerResponse.text("forbidden", { status: 403 });
      const tool = toolNamed((yield* HttpRouter.params).tool);
      if (!tool) return HttpServerResponse.text("not found", { status: 404 });
      return HttpServerResponse.jsonUnsafe(yield* (yield* ReviewTypes).startInstall(tool));
    }),
  ),
  HttpRouter.add("GET", "/review/:ticketId/hover", (request) =>
    Effect.gen(function* () {
      if (!localHost(request.headers["host"])) return HttpServerResponse.text("forbidden", { status: 403 });
      const { ticketId } = yield* HttpRouter.params;
      const at = position(request.url);
      if (!ticketIdOk(ticketId) || !at) return HttpServerResponse.text("bad request", { status: 400 });
      return HttpServerResponse.jsonUnsafe(yield* (yield* ReviewTypes).hover(ticketId, at.file, at.line, at.col));
    }),
  ),
  HttpRouter.add("GET", "/review/:ticketId/definition", (request) =>
    Effect.gen(function* () {
      if (!localHost(request.headers["host"])) return HttpServerResponse.text("forbidden", { status: 403 });
      const { ticketId } = yield* HttpRouter.params;
      const at = position(request.url);
      if (!ticketIdOk(ticketId) || !at) return HttpServerResponse.text("bad request", { status: 400 });
      return HttpServerResponse.jsonUnsafe(yield* (yield* ReviewTypes).definition(ticketId, at.file, at.line, at.col));
    }),
  ),
);
