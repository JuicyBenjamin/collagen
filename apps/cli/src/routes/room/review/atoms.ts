import { execFile } from "node:child_process";
import { Effect } from "effect";
import { McpInfo } from "../../../services/McpInfo";
import { ReviewPages } from "../../../services/ReviewLive";
import { focusTab } from "../../../lib/focusTab";
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
    const open = (yield* ReviewPages).isOpen(ticketId);
    // already open in a browser: bring that tab forward rather than another
    if (open && (yield* Effect.promise(() => focusTab(url)))) {
      yield* Effect.log(`review page brought forward: ${url}`);
      return;
    }
    // open but not reachable from here (another system, a browser with no
    // script): a new tab marked to take over — the old one hands it the
    // reader's place and closes itself
    const [cmd, args] = opener(open ? `${url}?take` : url);
    const ok = yield* Effect.callback<boolean>((resume) => {
      execFile(cmd, [...args], (err) => resume(Effect.succeed(err === null)));
    });
    yield* Effect.log(ok ? `review page opened: ${url}` : `review page: ${url} (could not open a browser — paste it into one)`);
  }),
);
