import { t } from "elysia";
import type { Static } from "elysia";

/**
 * The WebSocket wire contract — single source of truth.
 * TypeBox schemas drive BOTH runtime validation on the server (Elysia checks
 * inbound `body` against them) AND the static types the cli derives via Eden.
 * Define a message here once; both sides stay in sync.
 */

/** Query params required to open a workspace socket. */
export const wsQuery = t.Object({
  workspace: t.String({ minLength: 1 }),
});

/** Client → server. Discriminated union on `type`; grow it as features land. */
export const clientMessage = t.Union([t.Object({ type: t.Literal("ping") })]);

/** Server → client. */
export const serverMessage = t.Union([
  t.Object({
    type: t.Literal("welcome"),
    workspaceId: t.String(),
    clientId: t.String(),
    online: t.Integer(),
  }),
  t.Object({
    type: t.Literal("presence"),
    workspaceId: t.String(),
    online: t.Integer(),
  }),
  t.Object({ type: t.Literal("pong") }),
]);

export type ClientMessage = Static<typeof clientMessage>;
export type ServerMessage = Static<typeof serverMessage>;
