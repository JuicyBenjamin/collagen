import { t } from "elysia";
import type { Static } from "elysia";

/**
 * The WebSocket wire contract — single source of truth.
 * TypeBox schemas drive BOTH runtime validation on the server AND the static
 * types the cli derives via Eden.
 */

/** Query params to open a room (workspace = a better-auth team id). */
export const wsQuery = t.Object({
  workspace: t.String({ minLength: 1 }),
  name: t.Optional(t.String()),
});

/** One present client in a room. */
export const member = t.Object({
  clientId: t.String(),
  name: t.String(),
});

/** Client → server. */
export const clientMessage = t.Union([t.Object({ type: t.Literal("ping") })]);

/** Server → client. */
export const serverMessage = t.Union([
  t.Object({
    type: t.Literal("welcome"),
    workspaceId: t.String(),
    clientId: t.String(),
    members: t.Array(member),
  }),
  t.Object({
    type: t.Literal("presence"),
    workspaceId: t.String(),
    members: t.Array(member),
  }),
  t.Object({ type: t.Literal("pong") }),
]);

export type Member = Static<typeof member>;
export type ClientMessage = Static<typeof clientMessage>;
export type ServerMessage = Static<typeof serverMessage>;
