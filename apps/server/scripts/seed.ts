/**
 * Dev seed: two users (alice, bob) in one shared org + room, so presence can be
 * tested with two cli instances. Idempotent-ish (ignores "already exists").
 * Requires the server running. Run: `pnpm --filter @collagen/server seed`.
 */
import { createAuthClient } from "better-auth/client";
import { organizationClient } from "better-auth/client/plugins";

const BASE = process.env.COLLAGEN_SERVER ?? "http://localhost:3000";
const PASSWORD = "devpass123";

function mkClient() {
  let token = "";
  return createAuthClient({
    baseURL: BASE,
    plugins: [organizationClient({ teams: { enabled: true } })],
    fetchOptions: {
      headers: { Origin: BASE },
      auth: { type: "Bearer", token: () => token },
      onSuccess: (ctx) => {
        const t = ctx.response.headers.get("set-auth-token");
        if (t) token = t;
      },
    },
  });
}

type Client = ReturnType<typeof mkClient>;

async function ensureUser(c: Client, email: string, name: string): Promise<string> {
  const up = await c.signUp.email({ email, password: PASSWORD, name });
  if (!up.error && up.data?.user?.id) return up.data.user.id;
  const si = await c.signIn.email({ email, password: PASSWORD });
  if (si.error) throw new Error(`${email}: ${si.error.message}`);
  return si.data!.user.id;
}

const alice = mkClient();
const bob = mkClient();

await ensureUser(alice, "alice@collagen.dev", "Alice");
const bobId = await ensureUser(bob, "bob@collagen.dev", "Bob");
console.log("✓ users: alice, bob");

// org "Test Org"
const orgs = await alice.organization.list();
let org = orgs.data?.find((o) => o.slug === "test-org") ?? null;
if (!org) {
  org = (await alice.organization.create({ name: "Test Org", slug: "test-org" })).data ?? null;
}
if (!org) throw new Error("could not create/find org");
await alice.organization.setActive({ organizationId: org.id });
console.log("✓ org: Test Org", org.id);

// room "General"
const teams = (await alice.organization.listTeams({ query: { organizationId: org.id } })).data ?? [];
let general = teams.find((t) => t.name === "General") ?? null;
if (!general) {
  general = (await alice.organization.createTeam({ name: "General", organizationId: org.id })).data ?? null;
}
console.log("✓ room: General", general?.id);

// add bob to the org (+ team). Try addMember; fall back to invite/accept.
const orgAny = alice.organization as unknown as Record<string, (...a: unknown[]) => Promise<{ error?: { message?: string } }>>;
try {
  const r = await orgAny.addMember?.({
    userId: bobId,
    organizationId: org.id,
    role: "member",
    teamId: general?.id,
  });
  if (!r || r.error) throw new Error(r?.error?.message ?? "addMember unavailable");
  console.log("✓ bob added via addMember");
} catch (e) {
  console.log("addMember failed, trying invite/accept:", (e as Error).message);
  const inv = await orgAny.inviteMember?.({
    email: "bob@collagen.dev",
    role: "member",
    organizationId: org.id,
    teamId: general?.id,
  });
  const invId = (inv as { data?: { id?: string } } | undefined)?.data?.id;
  if (invId) {
    const acc = await (bob.organization as unknown as Record<string, (a: unknown) => Promise<{ error?: { message?: string } }>>)
      .acceptInvitation?.({ invitationId: invId });
    console.log(acc?.error ? `accept failed: ${acc.error.message}` : "✓ bob accepted invite");
  } else {
    console.log("invite produced no id (maybe already a member)");
  }
}

console.log("\nseed done. test with two terminals:");
console.log("  pnpm --filter @collagen/cli dev -- --user alice");
console.log("  pnpm --filter @collagen/cli dev -- --user bob");
process.exit(0);
