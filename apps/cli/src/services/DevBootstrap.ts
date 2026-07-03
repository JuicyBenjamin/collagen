import { homedir } from "node:os";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { FileSystem } from "@effect/platform";
import { Bootstrap } from "@collagen/p2p";

export const bootstrapFile = join(homedir(), ".config", "collagen", "dev-bootstrap.json");

const decode = Schema.decodeUnknown(Schema.parseJson(Bootstrap));

/** Dev-only: pick up a local testnet's bootstrap servers if the file exists.
 *  None on any failure — absence of the file is the normal production case. */
export const loadDevBootstrap = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const raw = yield* fs.readFileString(bootstrapFile);
  return yield* decode(raw);
}).pipe(Effect.option);
