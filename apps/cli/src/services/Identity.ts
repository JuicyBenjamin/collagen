import { homedir } from "node:os";
import { join } from "node:path";
import { Effect, Option, Schema } from "effect";
import { FileSystem } from "@effect/platform";
import { keyPairFromSeed, pubkeyHex, randomSeedHex, type Identity } from "@collagen/p2p";
import { CliArgs } from "./CliArgs";

const IdentityFile = Schema.parseJson(
  Schema.Struct({
    seed: Schema.optional(Schema.String),
    name: Schema.optional(Schema.String),
  }),
);

export const configDir = join(homedir(), ".config", "collagen");

/** Loads (or creates) the per-profile identity: persisted seed + display name.
 *  `--name` overrides and re-persists the stored name. */
export class IdentityService extends Effect.Service<IdentityService>()("cli/Identity", {
  effect: Effect.gen(function* () {
    const { profile, name: nameFlag } = yield* CliArgs;
    const fs = yield* FileSystem.FileSystem;
    const file = join(configDir, `identity-${profile}.json`);

    const stored = yield* fs.readFileString(file).pipe(
      Effect.flatMap(Schema.decode(IdentityFile)),
      Effect.option,
    );

    const seed = Option.flatMapNullable(stored, (s) => s.seed).pipe(
      Option.getOrElse(() => randomSeedHex()),
    );
    const name = Option.orElse(nameFlag, () => Option.flatMapNullable(stored, (s) => s.name)).pipe(
      Option.getOrElse(() => "anon"),
    );

    yield* fs.makeDirectory(configDir, { recursive: true });
    yield* Schema.encode(IdentityFile)({ seed, name }).pipe(
      Effect.flatMap((json) => fs.writeFileString(file, json)),
    );

    const keyPair = keyPairFromSeed(seed);
    const identity: Identity = { name, profile, keyPair, pubkey: pubkeyHex(keyPair.publicKey) };
    return { identity } as const;
  }),
}) {}
