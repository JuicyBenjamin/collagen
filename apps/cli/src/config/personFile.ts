import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PersonStored } from "@collagen/p2p";
import { NET } from "../app/net";

// What a device keeps to be its person again after a restart: the key the
// person is known by, and how to open their own log. A file of its own —
// the identity file is rewritten whole on start.

const configDir = join(homedir(), ".config", NET === "devnet" ? "collagen-devnet" : "collagen");
const personPath = (profile: string) => join(configDir, `person-${profile}.json`);

export const readPersonFile = (profile: string): PersonStored | null => {
  try {
    const kept = JSON.parse(readFileSync(personPath(profile), "utf8")) as Partial<PersonStored>;
    return typeof kept.person === "string" && typeof kept.logKey === "string" && typeof kept.encryptionKey === "string" ? { person: kept.person, logKey: kept.logKey, encryptionKey: kept.encryptionKey } : null;
  } catch {
    return null;
  }
};

export const writePersonFile = (profile: string, stored: PersonStored): void => {
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
  writeFileSync(personPath(profile), JSON.stringify(stored), { mode: 0o600 });
};
