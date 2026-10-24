import { Effect } from "effect";
import { diagnostics, type DiagnosticContext } from "../../../diagnostics";
import { Attachments } from "../../../services/Attachments";
import { Outbox } from "../../../services/Outbox";
import { Rooms } from "../../../services/Rooms";
import { IdentityService } from "../../../services/Identity";
import { Transcripts } from "../../../services/Transcripts";
import { runtimeAtom } from "../../../app/runtime";

/** Run one diagnostic from the registry with the params the page derived. */
export const runDiagnosticAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* ({ id, params, context }: { id: string; params: unknown; context: DiagnosticContext }) {
    const diagnostic = diagnostics.find((candidate) => candidate.id === id);
    if (!diagnostic) return `no diagnostic named ${id}`;
    const rooms = yield* Rooms;
    const transcripts = yield* Transcripts;
    const attachments = yield* Attachments;
    const { identity } = yield* IdentityService;
    return yield* diagnostic.run(params, context, { rooms, transcripts, attachments, me: identity.pubkey });
  }),
);

/** Take a step nobody has: the person's own act, through the outbox like any
 *  write — the same one take-step makes for their agent. */
export const takeStepAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* ({ roomId, ticketId, stepId, title }: { roomId: string; ticketId: string; stepId: string; title: string }) {
    return yield* (yield* Outbox).tell({ roomId, to: "the room", title: `${title} · ${stepId} taken`, outgoing: { kind: "take", ticketId, stepId } });
  }),
);
