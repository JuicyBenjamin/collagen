import { execFile } from "node:child_process";
import { Effect, Option } from "effect";
import { HttpServerRequest } from "effect/http";

// How collagen reaches a Claude Code conversation the person is sitting in:
// every Claude Code session is a process with a messaging socket of its own
// (CLAUDE_CODE_MESSAGING_SOCKET), and local sessions message each other
// through it — the desktop app's included. A tool call comes in over a
// loopback connection while that process waits on the answer, so the
// connection's far end names the process, and the process names its socket.
// Read from the call itself, never from the agent's word.

const run = (cmd: string, args: ReadonlyArray<string>): Promise<string | null> =>
  new Promise((resolve) => execFile(cmd, [...args], { timeout: 5_000 }, (error, out) => resolve(error ? null : String(out))));

/** The process at the other end of a loopback connection from `port`, other than this one. */
const processOn = async (port: number): Promise<number | null> => {
  const out = await run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:ESTABLISHED", "-Fp"]);
  const pids = (out ?? "").split("\n").flatMap((line) => (line.startsWith("p") ? [Number(line.slice(1))] : []));
  return pids.find((pid) => pid !== process.pid && Number.isInteger(pid)) ?? null;
};

/** A process's Claude Code messaging socket, if it holds one. */
const socketOf = async (pid: number): Promise<string | null> => {
  const out = await run("lsof", ["-a", "-p", String(pid), "-U", "-Fn"]);
  return (out ?? "").split("\n").find((line) => line.startsWith("n") && line.includes("/cc-socks/") && line.endsWith(".sock"))?.slice(1) ?? null;
};

/** The calling Claude Code session's messaging socket, read from the tool
 *  call's own connection — undefined off a call, or when it holds none. */
export const callerSocket: Effect.Effect<string | undefined> = Effect.gen(function* () {
  const request = Option.getOrUndefined(yield* Effect.serviceOption(HttpServerRequest.HttpServerRequest));
  const port = (request?.source as { readonly socket?: { readonly remotePort?: number } } | undefined)?.socket?.remotePort;
  if (port === undefined) return undefined;
  return yield* Effect.promise(async () => {
    const pid = await processOn(port);
    return pid === null ? undefined : ((await socketOf(pid)) ?? undefined);
  });
});

/** A socket address as SendMessage takes it. */
export const socketAddress = (socket: string): string => `uds:${socket}`;
