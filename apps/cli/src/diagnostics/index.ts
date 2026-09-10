import { Schema } from "effect";
import { Tool, Toolkit } from "effect/unstable/ai";
import type { Diagnostic } from "./registry";
import { attachFiles, fetchAttachments } from "./attachments";
import { reviewContext } from "./review";
import { listTranscripts, requestTranscripts } from "./transcripts";

export type { Diagnostic, DiagnosticContext, DiagnosticDeps } from "./registry";

/** Every diagnostic. Add one: write its file, list it here — the MCP server
 *  and the ticket page both pick it up. */
export const diagnostics: ReadonlyArray<Diagnostic<any>> = [requestTranscripts, listTranscripts, attachFiles, fetchAttachments, reviewContext];

/** The agent-facing tool for a diagnostic. All of them say what they are. */
const toTool = (d: Diagnostic<any>) =>
  Tool.make(d.id, {
    description: `DIAGNOSTIC, only when the user asks for it: ${d.summary}`,
    ...(d.params ? { parameters: d.params } : {}),
    success: Schema.String,
  });

export const DiagnosticToolkit = Toolkit.make(...diagnostics.map(toTool));
