import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";

// Persisted CLI auth lives under ~/.config/collagen/auth.json.
const dir = join(homedir(), ".config", "collagen");
const file = join(dir, "auth.json");

interface Stored {
  token?: string;
}

export async function loadToken(): Promise<string | null> {
  try {
    const f = Bun.file(file);
    if (!(await f.exists())) return null;
    return ((await f.json()) as Stored).token ?? null;
  } catch {
    return null;
  }
}

export async function saveToken(token: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await Bun.write(file, JSON.stringify({ token } satisfies Stored, null, 2));
}

export async function clearToken(): Promise<void> {
  try {
    await Bun.write(file, JSON.stringify({} satisfies Stored));
  } catch {
    // ignore
  }
}
