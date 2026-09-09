import { Effect } from "effect";
import { diagnostics, type DiagnosticContext } from "../../../diagnostics";
import { Attachments } from "../../../services/Attachments";
import { Rooms } from "../../../services/Rooms";
import { Transcripts } from "../../../services/Transcripts";
import { runtimeAtom } from "../../../app/runtime";

/** Run one diagnostic from the registry with the params the page derived. */
export const runDiagnosticAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* ({ id, params, ctx }: { id: string; params: unknown; ctx: DiagnosticContext }) {
    const d = diagnostics.find((x) => x.id === id);
    if (!d) return `no diagnostic named ${id}`;
    const rooms = yield* Rooms;
    const transcripts = yield* Transcripts;
    const attachments = yield* Attachments;
    return yield* d.run(params, ctx, { rooms, transcripts, attachments });
  }),
);
