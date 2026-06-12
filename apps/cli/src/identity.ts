import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import crypto from "hypercore-crypto";
import b4a from "b4a";

export interface Identity {
  name: string;
  profile: string;
  keyPair: { publicKey: Buffer; secretKey: Buffer };
  pubkey: string;
}

// P2P identity = a persisted keypair (no server, no accounts). `--profile`
// namespaces the keypair file so two peers can run on one machine.
export function loadIdentity(argv: string[]): Identity {
  const { values } = parseArgs({
    // pnpm forwards a literal "--" separator; drop it so flags parse.
    args: argv.slice(2).filter((a) => a !== "--"),
    options: {
      name: { type: "string", short: "n" },
      profile: { type: "string", short: "p" },
    },
    allowPositionals: true,
  });

  const profile = values.profile ?? "default";
  const dir = join(homedir(), ".config", "collagen");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `identity-${profile}.json`);

  let seedHex: string | undefined;
  let name: string | undefined;
  if (existsSync(file)) {
    const j = JSON.parse(readFileSync(file, "utf8")) as { seed?: string; name?: string };
    seedHex = j.seed;
    name = j.name;
  }
  if (!seedHex) seedHex = b4a.toString(crypto.randomBytes(32), "hex");
  if (values.name) name = values.name;
  if (!name) name = "anon";

  writeFileSync(file, JSON.stringify({ seed: seedHex, name }, null, 2));

  const keyPair = crypto.keyPair(b4a.from(seedHex, "hex"));
  return { name, profile, keyPair, pubkey: b4a.toString(keyPair.publicKey, "hex") };
}
