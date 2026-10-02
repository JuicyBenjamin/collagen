import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Context, Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import type { DefinitionResult, HoverResult, Peek } from "@collagen/review-web/data";
import { startLsp, type LspClient } from "../lib/lsp";
import { localHost, reviewTree, ticketIdOk } from "./ReviewView";

// Type hints and definition peeks on the review page, for TypeScript and
// JavaScript. The TypeScript is collagen's own — typescript 7 is a dependency
// of the cli, run as `tsc --lsp` — so a project on an older compiler, or with
// none installed, gets the same answers. The project gives the code: the
// branch under review, unpacked from the reader's clone into a folder of its
// own (git archive: the clone and its working tree are never touched), with
// the clone's node_modules linked in so imported packages have their types.
// Nothing leaves the machine; the server stops when nobody has asked for a
// while.

/** Where the bundled compiler is: resolved from the cli's own dependencies,
 *  never the project's. */
const tscPath = (): string => join(dirname(createRequire(import.meta.url).resolve("typescript/package.json")), "bin", "tsc");

const CODE = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
/** A path from the diff: relative, inside the tree, a file TypeScript reads. */
export const codePathOk = (file: string | undefined): file is string =>
  file !== undefined && file.length < 500 && !isAbsolute(file) && !file.split(/[\\/]/).includes("..") && CODE.has(extname(file));

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
  readonly root: string;
  readonly projectPath: string;
  readonly lsp: LspClient;
  readonly opened: Set<string>;
  lastUsed: number;
}

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

/** Link the clone's node_modules into the unpacked tree, beside every
 *  package.json that has one in the clone (a monorepo has several), so
 *  imports resolve to the types the reader has installed. */
const linkNodeModules = (projectPath: string, root: string, rel = "", depth = 0): void => {
  if (depth > 4) return;
  const here = join(root, rel);
  if (existsSync(join(here, "package.json"))) {
    const theirs = join(projectPath, rel, "node_modules");
    if (existsSync(theirs) && !existsSync(join(here, "node_modules"))) symlinkSync(theirs, join(here, "node_modules"), "dir");
  }
  let entries: Array<string> = [];
  try {
    entries = readdirSync(here, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== "node_modules" && !d.name.startsWith(".")).map((d) => d.name);
  } catch {
    return;
  }
  for (const name of entries) linkNodeModules(projectPath, root, join(rel, name), depth + 1);
};

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

    const stop = (key: string) => {
      const s = sessions.get(key);
      sessions.delete(key);
      void s?.then((x) => {
        x.lsp.close();
        rmSync(x.root, { recursive: true, force: true });
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

    const start = async (projectPath: string, commit: string, key: string): Promise<Session> => {
      const root = join(TREES, String(process.pid), key);
      rmSync(root, { recursive: true, force: true });
      await unpack(projectPath, commit, root);
      linkNodeModules(projectPath, root);
      const lsp = startLsp(process.execPath, [tscPath(), "--lsp", "--stdio"], root);
      const uri = pathToFileURL(root).href;
      await lsp.request("initialize", {
        processId: process.pid,
        rootUri: uri,
        workspaceFolders: [{ uri, name: "review" }],
        capabilities: { textDocument: { hover: { contentFormat: ["markdown", "plaintext"] }, definition: { linkSupport: true } } },
      });
      lsp.notify("initialized", {});
      return { root, projectPath, lsp, opened: new Set(), lastUsed: Date.now() };
    };

    /** The language server for a review's branch, started on first use and
     *  kept per commit — a branch that moves gets a fresh one. */
    const session = Effect.fn("ReviewTypes.session")(function* (ticketId: string) {
      const tree = yield* reviewTree(ticketId);
      if (typeof tree === "string") return tree;
      const key = `${ticketId.slice(0, 8)}-${tree.commit.slice(0, 12)}`;
      if (!sessions.has(key)) {
        for (const k of [...sessions.keys()]) if (k.startsWith(`${ticketId.slice(0, 8)}-`)) stop(k);
        const started = start(tree.projectPath, tree.commit, key);
        started.catch(() => sessions.delete(key));
        sessions.set(key, started);
      }
      return yield* Effect.tryPromise({ try: () => sessions.get(key)!, catch: (e) => (e instanceof Error ? e.message : String(e)) }).pipe(
        Effect.catch((why) => Effect.succeed(`the TypeScript server could not start: ${why}`)),
      );
    });

    /** Ask the server about a position in a file of the branch; opens the
     *  file for it first (the server answers about open documents). */
    const ask = Effect.fn("ReviewTypes.ask")(function* (ticketId: string, file: string, line: number, col: number, method: string) {
      const s = yield* session(ticketId);
      if (typeof s === "string") return { _tag: "failed", error: s } as const;
      s.lastUsed = Date.now();
      const path = join(s.root, file);
      if (!existsSync(path)) return { _tag: "failed", error: `${file} is not on the branch under review` } as const;
      const uri = pathToFileURL(path).href;
      if (!s.opened.has(uri)) {
        const ext = extname(file);
        const languageId = ext === ".tsx" ? "typescriptreact" : ext === ".jsx" ? "javascriptreact" : ext.includes("js") ? "javascript" : "typescript";
        s.lsp.notify("textDocument/didOpen", { textDocument: { uri, languageId, version: 1, text: readFileSync(path, "utf8") } });
        s.opened.add(uri);
      }
      // the page counts lines from 1 and characters from 0, as editors show them
      return yield* Effect.tryPromise({
        try: () => s.lsp.request(method, { textDocument: { uri }, position: { line: line - 1, character: col } }),
        catch: (e) => (e instanceof Error ? e.message : String(e)),
      }).pipe(
        Effect.map((result) => ({ _tag: "ok", result, session: s }) as const),
        Effect.catch((error) => Effect.succeed({ _tag: "failed", error } as const)),
      );
    });

    const hover = Effect.fn("ReviewTypes.hover")(function* (ticketId: string, file: string, line: number, col: number) {
      const r = yield* ask(ticketId, file, line, col, "textDocument/hover");
      if (r._tag === "failed") return { error: r.error } satisfies HoverResult;
      const markdown = hoverText(r.result);
      return (markdown ? { markdown } : { none: true }) satisfies HoverResult;
    });

    /** Where a symbol is declared, and the declaration itself: the target's
     *  whole range (a function with its body), capped, with where it lives —
     *  in the branch, in a package, or in TypeScript's own library. */
    const definition = Effect.fn("ReviewTypes.definition")(function* (ticketId: string, file: string, line: number, col: number) {
      const r = yield* ask(ticketId, file, line, col, "textDocument/definition");
      if (r._tag === "failed") return { error: r.error } satisfies DefinitionResult;
      const links = (Array.isArray(r.result) ? r.result : r.result ? [r.result] : []) as Array<{
        targetUri?: string;
        uri?: string;
        targetRange?: { start: { line: number }; end: { line: number } };
        range?: { start: { line: number }; end: { line: number } };
      }>;
      const { root, projectPath } = r.session;
      const realRoot = realpathSync(root);
      const peeks = links.slice(0, 3).flatMap((l): Array<Peek> => {
        const target = l.targetUri ?? l.uri ?? "";
        const range = l.targetRange ?? l.range;
        if (!range) return [];
        if (!target.startsWith("file:")) return [{ file: target.replace(/^bundled:\/\/\/libs\//, "typescript/lib/"), where: "typescript", line: range.start.line + 1, code: null, more: 0 }];
        const path = fileURLToPath(target);
        const real = (() => {
          try {
            return realpathSync(path);
          } catch {
            return path;
          }
        })();
        const inTree = real.startsWith(realRoot + sep);
        const full = inTree ? relative(realRoot, real) : real.startsWith(projectPath + sep) ? relative(projectPath, real) : real;
        // a package's file by the package, not by the store it sits in
        const inPackage = full.split(sep).includes("node_modules");
        const shown = inPackage ? full.slice(full.lastIndexOf(`node_modules${sep}`) + `node_modules${sep}`.length) : full;
        const lines = readFileSync(real, "utf8").split("\n");
        // the doc comment above a declaration is often what a reader needs most
        let from = range.start.line;
        while (from > 0 && range.start.line - from < 30 && /^\s*(\/\*\*?|\*|\/\/)/.test(lines[from - 1] ?? "")) from--;
        const to = Math.min(range.end.line, from + PEEK_LINES - 1);
        return [
          {
            file: shown,
            where: inPackage ? "package" : "branch",
            line: from + 1,
            code: lines.slice(from, to + 1).join("\n"),
            more: Math.max(0, range.end.line - to),
          },
        ];
      });
      // a name that is both a value and a namespace of types (Effect.fn):
      // the value — what the code calls — first
      const typesOnly = (p: Peek) => /^\s*(export\s+)?(declare\s+)?(namespace|module)\b/m.test((p.code ?? "").replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "").trimStart().split("\n")[0] ?? "");
      return { peeks: [...peeks.filter((p) => !typesOnly(p)), ...peeks.filter(typesOnly)] } satisfies DefinitionResult;
    });

    return { hover, definition } as const;
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

export const ReviewTypesRoutes = Layer.mergeAll(
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
