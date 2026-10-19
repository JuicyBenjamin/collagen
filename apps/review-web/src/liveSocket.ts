import type { ToolId, ToolState } from "./data";

// The page's live updates — the review moving, a language server's state —
// all on one WebSocket to collagen (ReviewServer's /review/_live). A browser
// lets a page hold only six connections to a host; a stream held open on
// each would take them all with a few tabs, and the next page, a file read
// or a reload would wait for one with no end and no error. A WebSocket is
// not counted against them. Each stream is a channel on it, by id; when the
// socket goes, every stream on it breaks, and `lasting` opens it again.

/** One channel's listener: a value, its end, or the socket gone. */
interface Listener {
  readonly value: (value: unknown) => void;
  readonly end: () => void;
  readonly broken: () => void;
}

let socket: WebSocket | null = null;
const listeners = new Map<string, Listener>();
let nextId = 0;

/** The page's socket, opened when a stream first needs it. */
const ensureSocket = (): WebSocket => {
  if (socket && socket.readyState <= WebSocket.OPEN) return socket;
  const opened = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/review/_live`);
  opened.addEventListener("message", (event: MessageEvent<string>) => {
    try {
      const message = JSON.parse(event.data) as { readonly id: string; readonly value?: unknown; readonly end?: true };
      const listener = listeners.get(message.id);
      if (!listener) return;
      if (message.end) listener.end();
      else listener.value(message.value);
    } catch {
      // not ours: ignored
    }
  });
  const gone = () => {
    if (socket !== opened) return;
    socket = null;
    for (const listener of [...listeners.values()]) listener.broken();
    listeners.clear();
  };
  opened.addEventListener("close", gone);
  opened.addEventListener("error", gone);
  socket = opened;
  return opened;
};

/** Say something to collagen, once the socket is open. */
const send = (target: WebSocket, ask: object) => {
  const text = JSON.stringify(ask);
  if (target.readyState === WebSocket.OPEN) target.send(text);
  else target.addEventListener("open", () => target.send(text), { once: true });
};

/** A live stream over the page's socket: its values as they come; it ends
 *  when collagen ends it, and breaks when the socket goes. The review's
 *  state as a token, or a language server's state. */
export function overSocket(topic: "changes", subject: string): AsyncIterable<string>;
export function overSocket(topic: "tool", subject: ToolId): AsyncIterable<ToolState>;
export function overSocket(topic: "changes" | "tool", subject: string): AsyncIterable<unknown> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<unknown> {
      const id = `s${++nextId}`;
      const queue: Array<IteratorResult<unknown> | "broken"> = [];
      let waiting: ((next: IteratorResult<unknown> | "broken") => void) | null = null;
      const deliver = (next: IteratorResult<unknown> | "broken") => {
        if (waiting) {
          const resolve = waiting;
          waiting = null;
          resolve(next);
        } else queue.push(next);
      };
      const target = ensureSocket();
      listeners.set(id, {
        value: (value) => deliver({ value, done: false }),
        end: () => deliver({ value: undefined, done: true }),
        broken: () => deliver("broken"),
      });
      send(target, { open: id, topic, subject });
      const finish = () => {
        if (!listeners.delete(id)) return;
        if (socket === target && target.readyState === WebSocket.OPEN) target.send(JSON.stringify({ close: id }));
        // the last stream gone, the socket goes with it
        if (listeners.size === 0 && socket === target) {
          socket = null;
          target.close();
        }
      };
      return {
        async next() {
          const next = queue.shift() ?? (await new Promise<IteratorResult<unknown> | "broken">((resolve) => (waiting = resolve)));
          if (next === "broken") throw new Error("the connection to collagen went");
          if (next.done) finish();
          return next;
        },
        async return() {
          finish();
          deliver({ value: undefined, done: true });
          return { value: undefined, done: true };
        },
      };
    },
  };
}
