import { execFile } from "node:child_process";
import { Effect } from "effect";
import { McpInfo } from "../../../services/McpInfo";
import { runtimeAtom } from "../../../app/runtime";

/** The browser's own opener for this platform. */
const opener = (url: string): readonly [string, ReadonlyArray<string>] =>
  process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];

/** Open the review page for a ticket — the diff read by intent — in the
 *  person's browser. Served by this instance on loopback, beside /mcp. The
 *  url goes to the activity log too, for a machine with no browser to open. */
export const openReviewPageAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* ({ ticketId }: { ticketId: string }) {
    const mcp = yield* (yield* McpInfo).awaitUrl;
    const url = `${mcp.replace(/\/mcp$/, "")}/review/${encodeURIComponent(ticketId)}`;
    const [cmd, args] = opener(url);
    const ok = yield* Effect.callback<boolean>((resume) => {
      execFile(cmd, [...args], (err) => resume(Effect.succeed(err === null)));
    });
    yield* Effect.log(ok ? `review page opened: ${url}` : `review page: ${url} (could not open a browser — paste it into one)`);
  }),
);
