import { GET, live } from "@solidjs/web/server-functions";
import type { DefinitionResult, HoverResult, ReviewPageData, SinceResult, ToolId, ToolState, WholeFileResult } from "./data";
import { run, stream } from "./server/backend";

// The page's server functions: called on the page like any function, run in
// the collagen instance on its own services (server/backend). Reads are
// GETs, so Solid can cache and refresh them; installing a tool is the one
// write. Nothing else goes between the page and the instance.

export const reviewData = GET(async (ticketId: string): Promise<ReviewPageData | null> => {
  "use server";
  return run((b) => b.data(ticketId));
});

/** The review's state as a token, current first and again whenever it
 *  moves: the page reads its data again when the token differs from the
 *  last it saw. Held open while the page is. */
export const reviewChanges = live(
  GET(async (ticketId: string): Promise<AsyncIterable<string>> => {
    "use server";
    return stream((b) => b.changes(ticketId));
  }),
);

export const hoverAt = GET(async (ticketId: string, file: string, line: number, col: number): Promise<HoverResult> => {
  "use server";
  return run((b) => b.hover(ticketId, file, line, col));
});

export const definitionAt = GET(async (ticketId: string, file: string, line: number, col: number): Promise<DefinitionResult> => {
  "use server";
  return run((b) => b.definition(ticketId, file, line, col));
});

export const toolState = GET(async (tool: ToolId): Promise<ToolState | null> => {
  "use server";
  return run((b) => b.tool(tool));
});

/** Install a language server — only ever on the reader's click. */
export const installTool = async (tool: ToolId): Promise<ToolState | null> => {
  "use server";
  return run((b) => b.install(tool));
};

export const wholeFile = GET(async (ticketId: string, file: string): Promise<WholeFileResult> => {
  "use server";
  return run((b) => b.wholeFile(ticketId, file));
});

export const sinceViewed = GET(async (ticketId: string, file: string, from: string): Promise<SinceResult> => {
  "use server";
  return run((b) => b.since(ticketId, file, from));
});
