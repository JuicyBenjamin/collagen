import { homedir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { FileSystem } from "effect";
import { keyPairFromSeed, pubkeyHex, randomSeedHex, type Identity } from "@collagen/p2p";
import { CliArgs } from "./CliArgs";

const IdentityFile = Schema.fromJsonString(
  Schema.Struct({
    seed: Schema.optional(Schema.String),
    name: Schema.optional(Schema.String),
    room: Schema.optional(Schema.String),
  }),
);

export const configDir = join(homedir(), ".config", "collagen");

/** Loads (or creates) the per-profile identity: persisted seed + display name.
 *  `--name` overrides and re-persists the stored name. */
export class IdentityService extends Context.Service<IdentityService>()("cli/Identity", {
  make: Effect.gen(function* () {
    const { profile, name: nameFlag, room: roomFlag } = yield* CliArgs;
    const fs = yield* FileSystem.FileSystem;
    const file = join(configDir, `identity-${profile}.json`);

    const stored = yield* fs.readFileString(file).pipe(
      Effect.flatMap(Schema.decodeEffect(IdentityFile)),
      Effect.option,
    );

    const seed = Option.flatMapNullishOr(stored, (s) => s.seed).pipe(
      Option.getOrElse(() => randomSeedHex()),
    );
    const name = Option.orElse(nameFlag, () => Option.flatMapNullishOr(stored, (s) => s.name)).pipe(
      Option.getOrElse(() => "anon"),
    );
    const room = Option.orElse(roomFlag, () => Option.flatMapNullishOr(stored, (s) => s.room)).pipe(
      Option.getOrElse(() => "lobby"),
    );

    yield* fs.makeDirectory(configDir, { recursive: true });
    yield* Schema.encodeEffect(IdentityFile)({ seed, name, room }).pipe(
      Effect.flatMap((json) => fs.writeFileString(file, json)),
    );

    const keyPair = keyPairFromSeed(seed);
    const identity: Identity = { name, profile, keyPair, pubkey: pubkeyHex(keyPair.publicKey) };
    return { identity, room } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
