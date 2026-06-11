import { defineContract } from "@prisma-next/postgres/contract-builder";

// Prisma Next contract = the TS-native schema. Edit, then `pnpm contract:emit`.
// NOTE: auth/org/team tables are owned by better-auth (separate adapter), NOT here.
// This package holds domain models only. `Event` is provisional — an audit trail
// of actions in a workspace, backing the org's "who did what, when, where" view.
export const contract = defineContract(
  {},
  ({ field, model }) => ({
    models: {
      Event: model("Event", {
        fields: {
          id: field.id.uuidv7(),
          // Maps to a better-auth team id (= workspace). Plain text for now;
          // cross-store FK is enforced in app logic, not the DB.
          workspaceId: field.text(),
          actorId: field.text().optional(),
          kind: field.text(),
          createdAt: field.temporal.createdAt(),
        },
      }),
    },
  }),
);
