import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { keyPairFromSeed, pubkeyHex, randomSeedHex, type Identity } from "@collagen/p2p";

// CLI-specific: parse flags + persist the seed/name, then build the identity
// via @collagen/p2p's keypair core. `--profile` namespaces the keypair file.
export function loadIdentity(argv: string[]): Identity {
  const { values } = parseArgs({
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
  if (!seedHex) seedHex = randomSeedHex();
  if (values.name) name = values.name;
  if (!name) name = "anon";

  writeFileSync(file, JSON.stringify({ seed: seedHex, name }, null, 2));

  const keyPair = keyPairFromSeed(seedHex);
  return { name, profile, keyPair, pubkey: pubkeyHex(keyPair.publicKey) };
}
