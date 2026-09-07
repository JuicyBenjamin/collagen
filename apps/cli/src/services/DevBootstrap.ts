import { homedir } from "node:os";
import { join } from "node:path";
import { Effect, Option, Schema } from "effect";
import { FileSystem } from "effect";
import { Bootstrap } from "@collagen/p2p";

/** Where the dev testnet advertises itself. Overridable so a test harness can
 *  run its own testnet without every other instance on the machine (a real
 *  TUI session, say) silently joining it on its next restart. */
export const bootstrapFile = process.env.COLLAGEN_BOOTSTRAP_FILE ?? join(homedir(), ".config", "collagen", "dev-bootstrap.json");

/** What dev-testnet writes: its bootstrap nodes AND its pid, so a client can
 *  tell a live testnet from a stale file left behind by a killed one. */
export const DevBootstrapFile = Schema.Struct({
  pid: Schema.Finite,
  bootstrap: Bootstrap,
});
const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(DevBootstrapFile));

const processAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Dev-only: pick up a local testnet's bootstrap servers if the file exists
 *  AND the testnet process is still running. A stale file (testnet SIGKILLed
 *  before its cleanup ran) would otherwise strand every client on this
 *  machine on a dead local DHT — silently, looking exactly like "no peers".
 *  None on any failure — absence of the file is the normal production case. */
export const loadDevBootstrap = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const raw = yield* fs.readFileString(bootstrapFile).pipe(Effect.option);
  if (Option.isNone(raw)) return Option.none<typeof Bootstrap.Type>();
  const parsed = yield* decode(raw.value).pipe(Effect.option);
  if (Option.isNone(parsed)) {
    yield* Effect.logWarning(`ignoring unreadable dev testnet file ${bootstrapFile} — using the public DHT`);
    yield* fs.remove(bootstrapFile).pipe(Effect.ignore);
    return Option.none<typeof Bootstrap.Type>();
  }
  if (!processAlive(parsed.value.pid)) {
    yield* Effect.logWarning(`stale dev testnet file (pid ${parsed.value.pid} is gone) — removing it, using the public DHT`);
    yield* fs.remove(bootstrapFile).pipe(Effect.ignore);
    return Option.none<typeof Bootstrap.Type>();
  }
  yield* Effect.log(`dev testnet detected (pid ${parsed.value.pid}) — joining the local DHT`);
  return Option.some(parsed.value.bootstrap);
});
