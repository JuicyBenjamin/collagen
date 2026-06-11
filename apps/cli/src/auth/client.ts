import { createAuthClient } from "better-auth/client";
import { organizationClient } from "better-auth/client/plugins";
import { clearToken, loadToken, saveToken } from "./store";

const baseURL = process.env.COLLAGEN_SERVER ?? "http://localhost:3000";

// In-memory mirror of the persisted bearer token. The CLI has no cookie jar,
// so we capture the token from the `set-auth-token` header on every response
// and attach it as `Authorization: Bearer` on every request.
let token: string | null = null;

/** Load any previously persisted token at startup. */
export async function initToken(): Promise<void> {
  token = await loadToken();
}

export function getToken(): string | null {
  return token;
}

// Dev-only seeded users for `--user` login bypass (see scripts/seed in server).
const DEV_USERS: Record<string, { email: string; password: string }> = {
  alice: { email: "alice@collagen.dev", password: "devpass123" },
  bob: { email: "bob@collagen.dev", password: "devpass123" },
};

/** Auto sign-in as a seeded dev user (bypasses the login screen). */
export async function devLogin(user: string): Promise<boolean> {
  const creds = DEV_USERS[user];
  if (!creds) return false;
  const r = await authClient.signIn.email(creds);
  return !r.error;
}

/** Sign out server-side, then drop the in-memory + persisted token. */
export async function logout(): Promise<void> {
  try {
    await authClient.signOut();
  } catch {
    // even if the server call fails, clear local creds
  }
  token = null;
  await clearToken();
}

export const authClient = createAuthClient({
  baseURL,
  plugins: [organizationClient({ teams: { enabled: true } })],
  fetchOptions: {
    // better-auth's org endpoints reject requests with no Origin (CSRF guard).
    // A CLI has none, so set it explicitly to the server URL.
    headers: { Origin: baseURL },
    auth: {
      type: "Bearer",
      token: () => token ?? "",
    },
    onSuccess: (ctx) => {
      const fresh = ctx.response.headers.get("set-auth-token");
      if (fresh) {
        token = fresh;
        void saveToken(fresh);
      }
    },
  },
});
