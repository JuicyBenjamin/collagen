import { homedir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Layer, Option, Schema, SubscriptionRef } from "effect";
import { FileSystem } from "effect";
import { keyPairFromSeed, pubkeyHex, randomSeedHex, type Identity } from "@collagen/p2p";
import { CliArgs } from "./CliArgs";

const RoomEntry = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  /** when the shared room name was last set — 0/absent loses to any gossip */
  nameTs: Schema.optional(Schema.Finite),
});

const IdentityFile = Schema.fromJsonString(
  Schema.Struct({
    seed: Schema.optional(Schema.String),
    name: Schema.optional(Schema.String),
    rooms: Schema.optional(Schema.Array(RoomEntry)),
    activeRoomId: Schema.optional(Schema.String),
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
    // Room: flag (id) > stored active room. No default room — a peer must
    // create or join one (the TUI's setup form handles this; headless runs
    // need --room or a configured profile).
    const knownRooms = Option.flatMapNullishOr(stored, (s) => s.rooms).pipe(Option.getOrElse(() => []));
    const activeId = Option.flatMapNullishOr(stored, (s) => s.activeRoomId);
    const storedActive = Option.orElse(
      Option.flatMapNullishOr(activeId, (id) => knownRooms.find((r) => r.id === id)),
      () => Option.fromNullishOr(knownRooms[0]),
    );
    const room = yield* roomFlag.pipe(
      Option.map((id) => knownRooms.find((r) => r.id === id) ?? { id, name: id.slice(0, 8) }),
      Option.orElse(() => storedActive),
      Option.match({
        onNone: () =>
          Effect.die(
            `profile "${profile}" has no room — start the TUI once to create/join one, or pass --room <id>`,
          ),
        onSome: Effect.succeed,
      }),
    );
    const rooms = knownRooms.some((r) => r.id === room.id) ? knownRooms : [...knownRooms, room];

    yield* fs.makeDirectory(configDir, { recursive: true });
    yield* Schema.encodeEffect(IdentityFile)({ seed, name, rooms, activeRoomId: room.id }).pipe(
      Effect.flatMap((json) => fs.writeFileString(file, json)),
    );

    const keyPair = keyPairFromSeed(seed);
    const identity: Identity = { name, profile, keyPair, pubkey: pubkeyHex(keyPair.publicKey) };
    // Live display name: settings change it without a restart. Persistence is
    // the caller's job (the settings screen writes the profile file).
    const nameRef = yield* SubscriptionRef.make(name);
    const setName = (newName: string) => SubscriptionRef.set(nameRef, newName);
    return { identity, room, knownRooms: rooms, nameRef, setName } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
