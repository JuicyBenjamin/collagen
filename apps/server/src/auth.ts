import { betterAuth } from "better-auth";
import { bearer, organization } from "better-auth/plugins";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

/**
 * better-auth owns identity (user/session/account) + tenancy (organization/
 * member/invitation) + teams (= our "workspace"). It talks to the SAME Postgres
 * as Prisma Next but via its own built-in Kysely adapter (pg Pool) and its own
 * tables — Prisma Next's db.orm API is incompatible with better-auth's adapter.
 *
 * A user (profile) exists independently of any org: membership is a join row,
 * so zero orgs is valid and one profile spans many orgs. Switching the active
 * org/team is a session concern (setActiveOrganization / setActiveTeam).
 */
export const auth = betterAuth({
  database: new Pool({ connectionString }),
  emailAndPassword: { enabled: true },
  plugins: [
    // CLI has no browser cookies — bearer() lets sign-in return a token
    // (set-auth-token header) the cli stores and sends as Authorization: Bearer.
    bearer(),
    organization({
      teams: { enabled: true },
    }),
  ],
});

export type Auth = typeof auth;
