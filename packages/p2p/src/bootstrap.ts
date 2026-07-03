import { homedir } from "node:os";
import { join } from "node:path";
import { Effect, Option, Schema } from "effect";
import { Bootstrap } from "./schema";

export const bootstrapFile = join(homedir(), ".config", "collagen", "dev-bootstrap.json");

const decode = Schema.decodeUnknown(Schema.parseJson(Bootstrap));

/** Dev-only: pick up a local testnet's bootstrap servers if the file exists.
 *  None on any failure — absence of the file is the normal production case. */
export const loadDevBootstrap: Effect.Effect<Option.Option<Bootstrap>> = Effect.gen(function* () {
  const fs = yield* Effect.promise(() => import("node:fs/promises"));
  const raw = yield* Effect.tryPromise(() => fs.readFile(bootstrapFile, "utf8"));
  return yield* decode(raw);
}).pipe(Effect.option);
