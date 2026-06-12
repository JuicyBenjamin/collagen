import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import createTestnet from "hyperdht/testnet.js";
import { bootstrapFile } from "@collagen/p2p";

// Local DHT for development: lets same-machine peers connect deterministically
// (the public DHT hairpins on localhost). Keep this running, then start clients.
const testnet = await createTestnet(3);
mkdirSync(dirname(bootstrapFile), { recursive: true });
writeFileSync(bootstrapFile, JSON.stringify(testnet.bootstrap));

console.log("collagen dev testnet running.");
console.log("bootstrap:", JSON.stringify(testnet.bootstrap));
console.log(`wrote ${bootstrapFile}`);
console.log("clients will auto-use it. ctrl+c to stop.");

async function shutdown() {
  try {
    rmSync(bootstrapFile, { force: true });
  } catch {
    // ignore
  }
  await testnet.destroy();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
