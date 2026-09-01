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
    room: Schema.optional(Schema.String), // legacy string form
    roomId: Schema.optional(Schema.String),
    roomName: Schema.optional(Schema.String),
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
    // Room: flag (id) > stored {roomId, roomName} > legacy stored string >
    // public lobby. The id keys the swarm topic; the name is a local label.
    const storedId = Option.flatMapNullishOr(stored, (s) => s.roomId).pipe(
      Option.orElse(() => Option.flatMapNullishOr(stored, (s) => s.room)),
    );
    const roomId = Option.orElse(roomFlag, () => storedId).pipe(Option.getOrElse(() => "lobby"));
    const roomName = Option.flatMapNullishOr(stored, (s) => s.roomName).pipe(
      Option.getOrElse(() => (roomId === "lobby" ? "lobby" : roomId.slice(0, 8))),
    );

    yield* fs.makeDirectory(configDir, { recursive: true });
    yield* Schema.encodeEffect(IdentityFile)({ seed, name, roomId, roomName }).pipe(
      Effect.flatMap((json) => fs.writeFileString(file, json)),
    );

    const keyPair = keyPairFromSeed(seed);
    const identity: Identity = { name, profile, keyPair, pubkey: pubkeyHex(keyPair.publicKey) };
    return { identity, room: { id: roomId, name: roomName } } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
