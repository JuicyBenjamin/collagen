import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

// Just enough of the Language Server Protocol to ask a server about code:
// JSON-RPC 2.0 over stdio, framed by Content-Length headers. The review
// page's type hints and definition peeks go through this to the language
// server of the file's language (services/ReviewTypes). A request the server
// makes of us (its settings, a progress token) is answered by `onRequest`,
// null by default; its notifications go to `onNotification` or are dropped.

/** Split a byte stream into LSP messages: returns the complete messages in
 *  `buffer` and whatever is left of an incomplete one. Pure, so the framing
 *  is tested without a server. */
export function readFrames(buffer: Buffer): { readonly messages: ReadonlyArray<unknown>; readonly rest: Buffer } {
  const messages: Array<unknown> = [];
  let rest: Buffer = buffer;
  while (true) {
    const end = rest.indexOf("\r\n\r\n");
    if (end < 0) break;
    const length = Number(/content-length:\s*(\d+)/i.exec(rest.subarray(0, end).toString("ascii"))?.[1]);
    if (!Number.isFinite(length)) {
      // not a header we understand: drop it rather than wedge the stream
      rest = rest.subarray(end + 4);
      continue;
    }
    const start = end + 4;
    if (rest.length < start + length) break;
    const body = rest.subarray(start, start + length).toString("utf8");
    rest = rest.subarray(start + length);
    try {
      messages.push(JSON.parse(body));
    } catch {
      // a broken message is skipped; the next one still frames
    }
  }
  return { messages, rest };
}

/** One message on the wire. */
export const frame = (message: unknown): Buffer => {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]);
};

interface Pending {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

export interface LspClient {
  readonly request: (method: string, params: unknown, timeoutMs?: number) => Promise<unknown>;
  readonly notify: (method: string, params: unknown) => void;
  readonly close: () => void;
  /** resolves when the server process has exited */
  readonly exited: Promise<number | null>;
}

export interface LspHandlers {
  readonly onStderr?: (line: string) => void;
  /** answer a request the server makes of us; undefined answers null */
  readonly onRequest?: (method: string, params: unknown) => unknown;
  readonly onNotification?: (method: string, params: unknown) => void;
}

/** Start a language server and talk to it. `command` and `args` run with
 *  `cwd` as their working directory. */
export function startLsp(command: string, args: ReadonlyArray<string>, cwd: string, handlers: LspHandlers = {}): LspClient {
  const { onStderr = () => {}, onRequest = () => null, onNotification = () => {} } = handlers;
  const child: ChildProcessWithoutNullStreams = spawn(command, [...args], { cwd, stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let buffer: Buffer = Buffer.alloc(0);
  let closed = false;

  const fail = (why: string) => {
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new Error(why));
    }
    pending.clear();
  };

  child.stdout.on("data", (chunk: Buffer) => {
    const { messages, rest } = readFrames(Buffer.concat([buffer, chunk]));
    buffer = rest;
    for (const m of messages) {
      const msg = m as { id?: number | string; method?: string; params?: unknown; result?: unknown; error?: { message?: string } };
      if (msg.method !== undefined && msg.id !== undefined) {
        // the server asks something of us (workspace/configuration, …)
        let result: unknown = null;
        try {
          result = onRequest(msg.method, msg.params) ?? null;
        } catch {
          // a handler that throws answers null rather than leaving it waiting
        }
        child.stdin.write(frame({ jsonrpc: "2.0", id: msg.id, result }));
        continue;
      }
      if (msg.method !== undefined) {
        onNotification(msg.method, msg.params);
        continue;
      }
      if (typeof msg.id !== "number") continue;
      const p = pending.get(msg.id);
      if (!p) continue;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(msg.error.message ?? "language server error"));
      else p.resolve(msg.result ?? null);
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split("\n")) if (line.trim()) onStderr(line);
  });
  const exited = new Promise<number | null>((resolve) =>
    child.on("exit", (code) => {
      closed = true;
      fail("the language server exited");
      resolve(code);
    }),
  );
  child.on("error", (e) => {
    closed = true;
    fail(`the language server did not start: ${e.message}`);
  });

  return {
    request: (method, params, timeoutMs = 20_000) =>
      new Promise((resolve, reject) => {
        if (closed) return reject(new Error("the language server is not running"));
        const id = nextId++;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method} timed out`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(frame({ jsonrpc: "2.0", id, method, params }));
      }),
    notify: (method, params) => {
      if (!closed) child.stdin.write(frame({ jsonrpc: "2.0", method, params }));
    },
    close: () => {
      if (closed) return;
      closed = true;
      fail("the language server was stopped");
      child.kill();
    },
    exited,
  };
}
