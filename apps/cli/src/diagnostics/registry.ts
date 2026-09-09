import type { Effect, Schema } from "effect";
import type { Rooms } from "../services/Rooms";
import type { Transcripts } from "../services/Transcripts";

/** What a diagnostic may use. Passed in, not pulled from context, so a
 *  diagnostic is a plain object both surfaces (TUI, MCP) can run the same way. */
export interface DiagnosticDeps {
  readonly rooms: Rooms["Service"];
  readonly transcripts: Transcripts["Service"];
}

/** Where the person (or agent) is when they run it. */
export interface DiagnosticContext {
  readonly roomId: string;
  readonly ticketId?: string;
}

/** One diagnostic. The MCP server makes a tool of it (id, summary, params);
 *  the ticket page lists it when `fromContext` can fill its params from where
 *  the person is. `run` returns the text both of them show. */
export interface Diagnostic<P = unknown> {
  readonly id: string;
  readonly title: string;
  /** The tool description — say plainly what leaves the machine, if anything. */
  readonly summary: string;
  /** The agent's parameters; omit when there are none. */
  readonly params?: Schema.Struct<Schema.Struct.Fields>;
  /** Params from the TUI context, or null when it doesn't apply there. */
  readonly fromContext: (ctx: DiagnosticContext) => P | null;
  readonly run: (params: P, ctx: DiagnosticContext, deps: DiagnosticDeps) => Effect.Effect<string>;
}

export const diagnostic = <P>(d: Diagnostic<P>): Diagnostic<P> => d;
